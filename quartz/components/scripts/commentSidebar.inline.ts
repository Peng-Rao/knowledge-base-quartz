export {}

interface GiscusUser {
  login: string
  avatarUrl: string
  url: string
}

interface GiscusReply {
  id: string
  author: GiscusUser
  bodyHTML: string
  createdAt: string
  url: string
}

interface GiscusComment extends GiscusReply {
  replies: GiscusReply[]
}

interface GiscusApiResponse {
  discussion: {
    id: string
    url: string
    totalCommentCount: number
    comments: GiscusComment[]
  }
  message?: string
}

interface DiscussionState {
  totalCommentCount: number
  comments: GiscusComment[]
}

const ARTICLE_SELECTOR = "article"
const SIDEBAR_LIST_SELECTOR = ".comment-sidebar-list"
const MARGIN_LAYER_ID = "comment-margin-layer"
const HIGHLIGHT_NAME = "comment-anchor"
const HIGHLIGHT_ACTIVE = "comment-anchor-active"

let lastDiscussionState: DiscussionState | null = null
const highlightRangesByCommentId: Map<string, Range[]> = new Map()
let resizeRaf: number | null = null
let inflightFetch: AbortController | null = null
let lastFetchAt = 0

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const sec = Math.max(1, Math.round((now - then) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.round(day / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.round(mo / 12)}y ago`
}

function parseBodyHtml(html: string): { quotes: string[]; previewHtml: string } {
  const tpl = document.createElement("template")
  tpl.innerHTML = html
  const root = tpl.content
  const quotes: string[] = []
  root.querySelectorAll("blockquote").forEach((bq) => {
    const text = (bq.textContent || "").replace(/\s+/g, " ").trim()
    if (text.length >= 8) quotes.push(text)
    bq.remove()
  })
  return { quotes, previewHtml: tpl.innerHTML.trim() }
}

function flattenComments(state: DiscussionState): GiscusReply[] {
  const out: GiscusReply[] = []
  for (const c of state.comments ?? []) {
    out.push(c)
    for (const r of c.replies ?? []) out.push(r)
  }
  return out
}

function findTextRanges(root: Element, target: string): Range[] {
  const ranges: Range[] = []
  if (!target) return ranges
  const needle = target.replace(/\s+/g, " ").trim().toLowerCase()
  if (needle.length < 8) return ranges

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const parent = (node as Text).parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (
        parent.closest(".comment-sidebar, .giscus, pre, code, script, style, .comment-margin-card")
      ) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const text = (node.textContent || "").toLowerCase()
    let from = 0
    while (true) {
      const idx = text.indexOf(needle, from)
      if (idx < 0) break
      const range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, idx + needle.length)
      ranges.push(range)
      from = idx + needle.length
    }
  }
  return ranges
}

function rebuildHighlights(state: DiscussionState) {
  highlightRangesByCommentId.clear()
  const article = document.querySelector(ARTICLE_SELECTOR)
  if (!article) return
  for (const c of flattenComments(state)) {
    const { quotes } = parseBodyHtml(c.bodyHTML)
    const ranges: Range[] = []
    for (const q of quotes) {
      ranges.push(...findTextRanges(article, q))
    }
    if (ranges.length > 0) highlightRangesByCommentId.set(c.id, ranges)
  }
  applyHighlights()
}

function applyHighlights(activeCommentId?: string) {
  const cssAny = CSS as unknown as { highlights?: Map<string, unknown> }
  if (!cssAny.highlights) return
  cssAny.highlights.delete(HIGHLIGHT_NAME)
  cssAny.highlights.delete(HIGHLIGHT_ACTIVE)

  const all: Range[] = []
  const active: Range[] = []
  for (const [id, ranges] of highlightRangesByCommentId.entries()) {
    if (activeCommentId && id === activeCommentId) {
      active.push(...ranges)
    } else {
      all.push(...ranges)
    }
  }
  try {
    const Ctor = (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight
    if (all.length > 0) cssAny.highlights.set(HIGHLIGHT_NAME, new Ctor(...all))
    if (active.length > 0) cssAny.highlights.set(HIGHLIGHT_ACTIVE, new Ctor(...active))
  } catch {
    /* ignore */
  }
}

function ensureMarginLayer(): HTMLElement {
  let layer = document.getElementById(MARGIN_LAYER_ID) as HTMLElement | null
  if (!layer) {
    layer = document.createElement("div")
    layer.id = MARGIN_LAYER_ID
    layer.className = "comment-margin-layer"
    document.body.appendChild(layer)
  }
  return layer
}

function renderCardInner(c: GiscusReply): string {
  const { previewHtml } = parseBodyHtml(c.bodyHTML)
  return `
    <a class="comment-margin-author" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">
      <img src="${escapeHtml(c.author.avatarUrl)}" alt="" loading="lazy" />
      <span class="comment-margin-name">${escapeHtml(c.author.login)}</span>
      <span class="comment-margin-time">${timeAgo(c.createdAt)}</span>
    </a>
    ${previewHtml ? `<div class="comment-margin-body">${previewHtml}</div>` : ""}
  `
}

function buildCard(c: GiscusReply): HTMLElement {
  const card = document.createElement("div")
  card.className = "comment-margin-card"
  card.dataset.commentId = c.id
  card.innerHTML = renderCardInner(c)
  card.addEventListener("mouseenter", () => applyHighlights(c.id))
  card.addEventListener("mouseleave", () => applyHighlights())
  card.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).closest("a")) return
    scrollToFirstHighlightFor(c.id)
  })
  return card
}

function layoutMarginCards() {
  const layer = document.getElementById(MARGIN_LAYER_ID)
  if (!layer) return
  const article = document.querySelector(ARTICLE_SELECTOR) as HTMLElement | null
  if (!article) return

  const articleRect = article.getBoundingClientRect()
  const layerLeft = articleRect.right + window.scrollX + 24
  const available = window.innerWidth - (articleRect.right + 24) - 16
  const width = Math.max(220, Math.min(320, available))

  if (available < 220) {
    layer.style.display = "none"
    return
  }
  layer.style.display = ""
  layer.style.left = `${layerLeft}px`
  layer.style.width = `${width}px`

  // Order cards by their target Y; stack to avoid overlap.
  const cards = Array.from(layer.querySelectorAll<HTMLElement>(".comment-margin-card"))
  const targets: { card: HTMLElement; top: number }[] = []
  for (const card of cards) {
    const id = card.dataset.commentId
    if (!id) continue
    const ranges = highlightRangesByCommentId.get(id)
    if (!ranges || ranges.length === 0) {
      card.style.display = "none"
      continue
    }
    card.style.display = ""
    const rect = ranges[0].getBoundingClientRect()
    targets.push({ card, top: rect.top + window.scrollY })
  }
  targets.sort((a, b) => a.top - b.top)

  const GAP = 8
  let cursor = -Infinity
  for (const t of targets) {
    const desired = Math.max(t.top, cursor + GAP)
    t.card.style.top = `${desired}px`
    // After layout, advance cursor by actual height
    cursor = desired + t.card.offsetHeight
  }
}

function scheduleLayout() {
  if (resizeRaf !== null) return
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null
    layoutMarginCards()
  })
}

function renderUnanchored(unanchored: GiscusReply[], totalCount: number) {
  const list = document.querySelector(SIDEBAR_LIST_SELECTOR) as HTMLElement | null
  if (!list) return
  if (totalCount === 0) {
    list.innerHTML =
      '<li class="comment-sidebar-empty">No comments yet. Select text on the page or scroll down to start the conversation.</li>'
    list.setAttribute("data-empty", "true")
    return
  }
  if (unanchored.length === 0) {
    list.innerHTML =
      '<li class="comment-sidebar-empty">All comments are anchored to passages in the article.</li>'
    list.setAttribute("data-empty", "true")
    return
  }
  list.removeAttribute("data-empty")
  list.innerHTML = unanchored
    .map((c) => {
      const { previewHtml } = parseBodyHtml(c.bodyHTML)
      return `
        <li class="comment-sidebar-item">
          <a class="comment-author" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">
            <img src="${escapeHtml(c.author.avatarUrl)}" alt="" loading="lazy" />
            <span class="comment-author-name">${escapeHtml(c.author.login)}</span>
            <span class="comment-time">${timeAgo(c.createdAt)}</span>
          </a>
          ${previewHtml ? `<div class="comment-body">${previewHtml}</div>` : ""}
        </li>
      `
    })
    .join("")
}

function renderAll(state: DiscussionState) {
  rebuildHighlights(state)

  const layer = ensureMarginLayer()
  layer.innerHTML = ""

  const flat = flattenComments(state)
  const unanchored: GiscusReply[] = []
  for (const c of flat) {
    if (highlightRangesByCommentId.has(c.id)) {
      layer.appendChild(buildCard(c))
    } else {
      unanchored.push(c)
    }
  }

  renderUnanchored(unanchored, state.totalCommentCount)
  scheduleLayout()
  setTimeout(scheduleLayout, 250)
  setTimeout(scheduleLayout, 1200)
}

function scrollToFirstHighlightFor(commentId: string) {
  const ranges = highlightRangesByCommentId.get(commentId)
  if (!ranges || ranges.length === 0) return
  const rect = ranges[0].getBoundingClientRect()
  window.scrollTo({
    top: rect.top + window.scrollY - 120,
    behavior: "smooth",
  })
}

function showToast(message: string) {
  const toast = document.createElement("div")
  toast.className = "comment-sidebar-toast"
  toast.textContent = message
  document.body.appendChild(toast)
  requestAnimationFrame(() => toast.classList.add("visible"))
  setTimeout(() => {
    toast.classList.remove("visible")
    setTimeout(() => toast.remove(), 250)
  }, 3500)
}

function quoteSelectionAndScroll() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return
  const text = sel.toString().trim()
  if (!text) return
  const quoted =
    text
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n") + "\n\n"

  const finish = () => {
    const giscus = document.querySelector(".giscus")
    if (giscus) giscus.scrollIntoView({ behavior: "smooth", block: "start" })
    showToast("Quote copied. Paste it into the comment box below (⌘/Ctrl + V).")
  }

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(quoted).then(finish).catch(finish)
  } else {
    const ta = document.createElement("textarea")
    ta.value = quoted
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand("copy")
    } catch {
      /* ignore */
    }
    ta.remove()
    finish()
  }
}

function setupSelectionUI(cleanups: Array<() => void>) {
  let button: HTMLButtonElement | null = null

  const removeButton = () => {
    button?.remove()
    button = null
  }

  const onSelectionChange = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      removeButton()
      return
    }
    const text = sel.toString().trim()
    if (!text) {
      removeButton()
      return
    }
    const article = document.querySelector(ARTICLE_SELECTOR)
    if (!article) {
      removeButton()
      return
    }
    const anchor = sel.anchorNode
    const focus = sel.focusNode
    if (!anchor || !focus || !article.contains(anchor) || !article.contains(focus)) {
      removeButton()
      return
    }

    if (!button) {
      button = document.createElement("button")
      button.type = "button"
      button.className = "comment-selection-btn"
      button.textContent = "💬 Comment on this"
      button.addEventListener("mousedown", (e) => e.preventDefault())
      button.addEventListener("click", () => {
        quoteSelectionAndScroll()
        removeButton()
        window.getSelection()?.removeAllRanges()
      })
      document.body.appendChild(button)
    }

    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const top = rect.top + window.scrollY - 40
    const left = Math.max(8, rect.left + window.scrollX + rect.width / 2 - 80)
    button.style.top = `${top}px`
    button.style.left = `${left}px`
  }

  const onScroll = () => {
    if (button) removeButton()
  }

  document.addEventListener("selectionchange", onSelectionChange)
  window.addEventListener("scroll", onScroll, { passive: true })
  cleanups.push(() => {
    document.removeEventListener("selectionchange", onSelectionChange)
    window.removeEventListener("scroll", onScroll)
    removeButton()
  })
}

function isGiscusMessage(event: MessageEvent): boolean {
  return (
    event.origin === "https://giscus.app" &&
    typeof event.data === "object" &&
    event.data !== null &&
    "giscus" in event.data
  )
}

function buildGiscusTerm(giscus: HTMLElement): string {
  const mapping = giscus.dataset.mapping || "url"
  switch (mapping) {
    case "pathname": {
      let p = window.location.pathname
      if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1)
      if (p.toLowerCase().endsWith(".html")) p = p.slice(0, -5)
      return p
    }
    case "url":
      return window.location.origin + window.location.pathname
    case "title":
      return document.title
    case "og:title": {
      const og = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null
      return og?.content || document.title
    }
    default:
      return window.location.pathname
  }
}

async function fetchDiscussion(): Promise<GiscusApiResponse | null> {
  const giscus = document.querySelector(".giscus") as HTMLElement | null
  if (!giscus) return null
  const repo = giscus.dataset.repo
  const categoryId = giscus.dataset.categoryId
  if (!repo || !categoryId) return null

  const params = new URLSearchParams({
    repo,
    term: buildGiscusTerm(giscus),
    category: giscus.dataset.category || "",
    category_id: categoryId,
    strict: giscus.dataset.strict || "0",
    backLink: window.location.href,
  })

  inflightFetch?.abort()
  inflightFetch = new AbortController()
  try {
    // Use corsproxy.io to bypass Giscus CORS restrictions
    const targetUrl = encodeURIComponent(`https://giscus.app/api/discussions?${params.toString()}`)
    const res = await fetch(`https://corsproxy.io/?${targetUrl}`, {
      signal: inflightFetch.signal,
    })
    if (!res.ok) return null
    return (await res.json()) as GiscusApiResponse
  } catch {
    return null
  } finally {
    inflightFetch = null
  }
}

async function refresh(force = false) {
  const now = Date.now()
  if (!force && now - lastFetchAt < 1500) return
  lastFetchAt = now
  console.log("[CommentSidebar] refresh()")
  const data = await fetchDiscussion()
  console.log("[CommentSidebar] fetched:", data)
  if (!data) {
    const list = document.querySelector(SIDEBAR_LIST_SELECTOR) as HTMLElement | null
    if (list) {
      list.innerHTML = '<li class="comment-sidebar-empty">Could not load comments.</li>'
    }
    return
  }
  const comments = data.discussion?.comments ?? []
  lastDiscussionState = {
    totalCommentCount: data.discussion?.totalCommentCount ?? comments.length,
    comments,
  }
  console.log("[CommentSidebar] state:", lastDiscussionState)
  renderAll(lastDiscussionState)
}

document.addEventListener("nav", () => {
  console.log("[CommentSidebar] nav handler firing")
  const sidebar = document.querySelector(".comment-sidebar") as HTMLElement | null
  if (!sidebar) {
    console.log("[CommentSidebar] no .comment-sidebar in DOM")
    return
  }

  if (!document.querySelector(".giscus")) {
    console.log("[CommentSidebar] no .giscus container; hiding sidebar")
    sidebar.style.display = "none"
    return
  }

  const cleanups: Array<() => void> = []

  // Fetch immediately, plus when Giscus posts a metadata update
  // (which happens when comments/reactions/replies change).
  refresh(true)

  const onMessage = (event: MessageEvent) => {
    if (!isGiscusMessage(event)) return
    refresh()
  }
  window.addEventListener("message", onMessage)
  cleanups.push(() => window.removeEventListener("message", onMessage))

  setupSelectionUI(cleanups)

  const onResize = () => scheduleLayout()
  window.addEventListener("resize", onResize)
  window.addEventListener("scroll", scheduleLayout, { passive: true })
  cleanups.push(() => {
    window.removeEventListener("resize", onResize)
    window.removeEventListener("scroll", scheduleLayout)
  })

  const article = document.querySelector(ARTICLE_SELECTOR)
  if (article && "ResizeObserver" in window) {
    const ro = new ResizeObserver(() => scheduleLayout())
    ro.observe(article)
    cleanups.push(() => ro.disconnect())
  }

  if (lastDiscussionState) renderAll(lastDiscussionState)
  ;(window as unknown as { addCleanup: (fn: () => void) => void }).addCleanup(() => {
    cleanups.forEach((fn) => fn())
    inflightFetch?.abort()
    const layer = document.getElementById(MARGIN_LAYER_ID)
    layer?.remove()
  })
})

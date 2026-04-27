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
const HIGHLIGHT_NAME = "comment-anchor"
const HIGHLIGHT_ACTIVE = "comment-anchor-active"

let lastDiscussionState: DiscussionState | null = null
const highlightRangesByCommentId: Map<string, Range[]> = new Map()
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
    let quoteText = ""

    const pElements = Array.from(bq.querySelectorAll("p"))
    if (pElements.length > 1) {
      quoteText = pElements[0].textContent || ""
      for (let i = 1; i < pElements.length; i++) {
        bq.parentNode?.insertBefore(pElements[i].cloneNode(true), bq.nextSibling)
      }
    } else {
      const br = bq.querySelector("br")
      if (br && br.parentElement) {
        const p = br.parentElement
        let curr = p.firstChild
        while (curr && curr !== br) {
          quoteText += curr.textContent || ""
          curr = curr.nextSibling
        }

        const commentP = document.createElement("p")
        curr = br.nextSibling
        while (curr) {
          const next = curr.nextSibling
          commentP.appendChild(curr.cloneNode(true))
          curr = next
        }
        if (commentP.childNodes.length > 0) {
          bq.parentNode?.insertBefore(commentP, bq.nextSibling)
        }
      } else {
        quoteText = bq.textContent || ""
      }
    }

    const cleanQuote = quoteText.replace(/\s+/g, " ").trim()
    if (cleanQuote.length >= 4) {
      quotes.push(cleanQuote)
    }
    bq.remove()
  })

  return { quotes, previewHtml: tpl.innerHTML.trim() }
}

function flattenComments(state: DiscussionState): (GiscusReply & { isReply?: boolean })[] {
  const out: (GiscusReply & { isReply?: boolean })[] = []
  for (const c of state.comments ?? []) {
    out.push(c)
    for (const r of c.replies ?? []) {
      out.push({ ...r, isReply: true })
    }
  }
  return out
}

function findTextRanges(root: Element, target: string): Range[] {
  const ranges: Range[] = []
  if (!target) return ranges
  const needleNoSpaces = target.replace(/\s+/g, "").toLowerCase()
  if (needleNoSpaces.length < 4) return ranges

  const charMap: { node: Text; offset: number; char: string }[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const parent = (node as Text).parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.closest(".comment-sidebar, .giscus, script, style")) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent || ""
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (!/\s/.test(c)) {
        charMap.push({ node, offset: i, char: c.toLowerCase() })
      }
    }
  }

  const fullText = charMap.map((c) => c.char).join("")

  let from = 0
  while (true) {
    const idx = fullText.indexOf(needleNoSpaces, from)
    if (idx < 0) break

    const startMap = charMap[idx]
    const endMap = charMap[idx + needleNoSpaces.length - 1]

    const range = document.createRange()
    range.setStart(startMap.node, startMap.offset)
    range.setEnd(endMap.node, endMap.offset + 1)
    ranges.push(range)

    from = idx + needleNoSpaces.length
  }

  return ranges
}

function rebuildHighlights(state: DiscussionState) {
  highlightRangesByCommentId.clear()
  const article = document.querySelector(ARTICLE_SELECTOR)
  if (!article) return

  for (const c of state.comments ?? []) {
    const { quotes } = parseBodyHtml(c.bodyHTML)
    const ranges: Range[] = []
    for (const q of quotes) {
      ranges.push(...findTextRanges(article, q))
    }

    if (ranges.length > 0) {
      highlightRangesByCommentId.set(c.id, ranges)
      for (const r of c.replies ?? []) {
        highlightRangesByCommentId.set(r.id, ranges)
      }
    } else {
      for (const r of c.replies ?? []) {
        const { quotes: rQuotes } = parseBodyHtml(r.bodyHTML)
        const rRanges: Range[] = []
        for (const q of rQuotes) {
          rRanges.push(...findTextRanges(article, q))
        }
        if (rRanges.length > 0) {
          highlightRangesByCommentId.set(c.id, rRanges)
          for (const rep of c.replies ?? []) {
            highlightRangesByCommentId.set(rep.id, rRanges)
          }
          break
        }
      }
    }
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

function getCommentIdFromPoint(x: number, y: number): string | null {
  for (const [id, ranges] of highlightRangesByCommentId.entries()) {
    for (const r of ranges) {
      const rects = r.getClientRects()
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i]
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return id
        }
      }
    }
  }
  return null
}

function highlightSidebarItem(id: string) {
  document.querySelectorAll(".comment-sidebar-item").forEach((el) => {
    if ((el as HTMLElement).dataset.commentId === id) {
      el.classList.add("active-comment")
    } else {
      el.classList.remove("active-comment")
    }
  })
}

function unhighlightSidebarItems() {
  document.querySelectorAll(".comment-sidebar-item").forEach((el) => {
    el.classList.remove("active-comment")
  })
}

let resizeRaf: number | null = null
function scheduleLayout() {
  if (resizeRaf !== null) return
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null
    layoutSidebarCards()
  })
}

function layoutSidebarCards() {
  const list = document.querySelector(SIDEBAR_LIST_SELECTOR) as HTMLElement | null
  const article = document.querySelector(ARTICLE_SELECTOR) as HTMLElement | null
  const rightSidebar = document.querySelector(".sidebar.right") as HTMLElement | null
  if (!list || !article || !rightSidebar) return

  const cards = Array.from(list.querySelectorAll<HTMLElement>(".comment-sidebar-item"))
  const isDesktop = window.innerWidth >= 1200

  if (!isDesktop) {
    list.style.position = "relative"
    list.style.minHeight = "auto"
    for (const card of cards) {
      card.style.position = "relative"
      card.style.top = "auto"
      card.style.marginBottom = "1rem"
    }
    return
  }

  list.style.position = "absolute"

  const listRect = list.getBoundingClientRect()
  const targets: { card: HTMLElement; top: number }[] = []

  for (const card of cards) {
    const id = card.dataset.commentId
    if (!id) continue
    const ranges = highlightRangesByCommentId.get(id)
    if (!ranges || ranges.length === 0) {
      targets.push({ card, top: 9999999 })
      continue
    }
    const rect = ranges[0].getBoundingClientRect()
    targets.push({ card, top: rect.top - listRect.top })
  }

  targets.sort((a, b) => a.top - b.top)

  const GAP = 12
  let cursor = 0

  for (const t of targets) {
    if (t.top === 9999999) continue
    const desired = Math.max(t.top, cursor)
    t.card.style.top = `${desired}px`
    t.card.style.position = "absolute"
    cursor = desired + t.card.offsetHeight + GAP
  }

  let unanchoredCursor = cursor + 40

  for (const t of targets) {
    if (t.top === 9999999) {
      t.card.style.top = `${unanchoredCursor}px`
      t.card.style.position = "absolute"
      unanchoredCursor += t.card.offsetHeight + GAP
    }
  }

  list.style.minHeight = `${unanchoredCursor}px`
}

function renderAll(state: DiscussionState) {
  rebuildHighlights(state)

  const list = document.querySelector(SIDEBAR_LIST_SELECTOR) as HTMLElement | null
  if (!list) return

  list.innerHTML = ""

  if (state.totalCommentCount === 0) {
    list.innerHTML =
      '<li class="comment-sidebar-empty">No comments yet. Select text on the page or scroll down to start the conversation.</li>'
    list.setAttribute("data-empty", "true")
    scheduleLayout()
    return
  }

  list.removeAttribute("data-empty")

  const flat = flattenComments(state)
  for (const c of flat) {
    const li = document.createElement("li")
    li.className = "comment-sidebar-item"
    li.dataset.commentId = c.id
    if (c.isReply) {
      li.style.marginLeft = "1.5rem"
      li.style.borderLeftColor = "var(--tertiary)"
      li.style.opacity = "0.9"
    }

    if (highlightRangesByCommentId.has(c.id)) {
      li.classList.add("anchored")
    }

    const { previewHtml } = parseBodyHtml(c.bodyHTML)

    li.innerHTML = `
      <div class="comment-author">
        <img src="${escapeHtml(c.author.avatarUrl)}" alt="" loading="lazy" />
        <a class="comment-author-name" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.author.login)}</a>
        <span class="comment-time">${timeAgo(c.createdAt)}</span>
      </div>
      ${previewHtml ? `<div class="comment-body">${previewHtml}</div>` : ""}
    `

    if (highlightRangesByCommentId.has(c.id)) {
      li.style.cursor = "pointer"
      li.addEventListener("mouseenter", () => {
        applyHighlights(c.id)
        highlightSidebarItem(c.id)
      })
      li.addEventListener("mouseleave", () => {
        applyHighlights()
        unhighlightSidebarItems()
      })
      li.addEventListener("click", (ev) => {
        if ((ev.target as HTMLElement).closest("a")) return
        scrollToFirstHighlightFor(c.id)
      })
    }

    list.appendChild(li)
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scheduleLayout()
    })
  })
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

function setupArticleInteractions(cleanups: Array<() => void>) {
  const article = document.querySelector(ARTICLE_SELECTOR) as HTMLElement | null
  if (!article) return

  let activeHighlightId: string | null = null

  const onMouseMove = (e: MouseEvent) => {
    const id = getCommentIdFromPoint(e.clientX, e.clientY)
    if (id !== activeHighlightId) {
      activeHighlightId = id
      if (id) {
        applyHighlights(id)
        highlightSidebarItem(id)
        article.style.cursor = "pointer"
      } else {
        applyHighlights()
        unhighlightSidebarItems()
        article.style.cursor = ""
      }
    }
  }

  const onClick = (e: MouseEvent) => {
    const id = getCommentIdFromPoint(e.clientX, e.clientY)
    if (id) {
      const card = document.querySelector(
        `.comment-sidebar-item[data-comment-id="${id}"]`,
      ) as HTMLElement
      if (card) {
        const cardRect = card.getBoundingClientRect()
        if (cardRect.top < 0 || cardRect.bottom > window.innerHeight) {
          card.scrollIntoView({ behavior: "smooth", block: "center" })
        }
      }
    }
  }

  article.addEventListener("mousemove", onMouseMove)
  article.addEventListener("click", onClick)

  cleanups.push(() => {
    article.removeEventListener("mousemove", onMouseMove)
    article.removeEventListener("click", onClick)
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
  const data = await fetchDiscussion()
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
  renderAll(lastDiscussionState)
}

document.addEventListener("nav", () => {
  const sidebar = document.querySelector(".comment-sidebar") as HTMLElement | null
  if (!sidebar) {
    return
  }

  if (!document.querySelector(".giscus")) {
    sidebar.style.display = "none"
    return
  }

  const cleanups: Array<() => void> = []

  refresh(true)

  const onMessage = (event: MessageEvent) => {
    if (!isGiscusMessage(event)) return
    refresh()
  }
  window.addEventListener("message", onMessage)
  cleanups.push(() => window.removeEventListener("message", onMessage))

  setupSelectionUI(cleanups)
  setupArticleInteractions(cleanups)

  if (lastDiscussionState) renderAll(lastDiscussionState)

  const ro = new ResizeObserver(() => scheduleLayout())
  ro.observe(document.body)
  cleanups.push(() => ro.disconnect())
  ;(window as unknown as { addCleanup: (fn: () => void) => void }).addCleanup(() => {
    cleanups.forEach((fn) => fn())
    inflightFetch?.abort()
  })
})

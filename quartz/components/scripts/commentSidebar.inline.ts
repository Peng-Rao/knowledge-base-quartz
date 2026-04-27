interface GiscusUser {
  login: string
  avatarUrl: string
  url: string
}

interface GiscusReply {
  id: string
  author: GiscusUser
  body: string
  createdAt: string
  url: string
}

interface GiscusComment extends GiscusReply {
  replies: GiscusReply[]
}

interface GiscusDiscussion {
  id: string
  url: string
  totalCommentCount: number
  totalReplyCount: number
}

interface GiscusMetadata {
  discussion: GiscusDiscussion
  viewer: GiscusUser
}

interface GiscusDiscussionData {
  discussion: GiscusDiscussion
  comments: GiscusComment[]
  // older shape compatibility
  totalCommentCount?: number
}

export {}

const ARTICLE_SELECTOR = "article"
const SIDEBAR_LIST_SELECTOR = ".comment-sidebar-list"
const HIGHLIGHT_NAME = "comment-anchor"
const QUOTE_LINE = /^>\s?(.*)$/

let lastDiscussionData: GiscusDiscussionData | null = null
let highlightRangesByCommentId: Map<string, Range[]> = new Map()

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

function extractQuotedSpans(body: string): string[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n")
  const out: string[] = []
  let buf: string[] = []
  for (const line of lines) {
    const m = line.match(QUOTE_LINE)
    if (m) {
      buf.push(m[1])
    } else if (buf.length > 0) {
      const joined = buf.join(" ").replace(/\s+/g, " ").trim()
      if (joined.length >= 8) out.push(joined)
      buf = []
    }
  }
  if (buf.length > 0) {
    const joined = buf.join(" ").replace(/\s+/g, " ").trim()
    if (joined.length >= 8) out.push(joined)
  }
  return out
}

function bodyPreview(body: string, max = 240): string {
  const stripped = body
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
  if (!stripped) return ""
  return stripped.length > max ? stripped.slice(0, max - 1) + "…" : stripped
}

function flattenComments(data: GiscusDiscussionData): GiscusReply[] {
  const out: GiscusReply[] = []
  for (const c of data.comments ?? []) {
    out.push(c)
    for (const r of c.replies ?? []) out.push(r)
  }
  return out
}

function renderComment(c: GiscusReply): string {
  const preview = bodyPreview(c.body)
  const quotes = extractQuotedSpans(c.body)
  const quotesHtml = quotes
    .map((q) => `<blockquote class="comment-quote">${escapeHtml(q)}</blockquote>`)
    .join("")
  return `
    <li class="comment-sidebar-item" data-comment-id="${escapeHtml(c.id)}">
      <a class="comment-author" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">
        <img src="${escapeHtml(c.author.avatarUrl)}" alt="" loading="lazy" />
        <span class="comment-author-name">${escapeHtml(c.author.login)}</span>
        <span class="comment-time">${timeAgo(c.createdAt)}</span>
      </a>
      ${quotesHtml}
      ${preview ? `<p class="comment-body">${escapeHtml(preview)}</p>` : ""}
    </li>
  `
}

function renderSidebar(data: GiscusDiscussionData) {
  const list = document.querySelector(SIDEBAR_LIST_SELECTOR) as HTMLElement | null
  if (!list) return
  const flat = flattenComments(data)
  if (flat.length === 0) {
    list.innerHTML =
      '<li class="comment-sidebar-empty">No comments yet. Select text or scroll down to start the conversation.</li>'
    list.setAttribute("data-empty", "true")
    return
  }
  list.innerHTML = flat.map(renderComment).join("")
  list.removeAttribute("data-empty")

  list.querySelectorAll(".comment-sidebar-item").forEach((el) => {
    el.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement
      if (target.closest("a")) return
      const id = (el as HTMLElement).dataset.commentId
      if (!id) return
      scrollToFirstHighlightFor(id)
    })
  })
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
      if (parent.closest(".comment-sidebar, .giscus, pre, code, script, style")) {
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

function rebuildHighlights(data: GiscusDiscussionData) {
  highlightRangesByCommentId.clear()
  const article = document.querySelector(ARTICLE_SELECTOR)
  if (!article) return
  for (const c of flattenComments(data)) {
    const quotes = extractQuotedSpans(c.body)
    const ranges: Range[] = []
    for (const q of quotes) {
      ranges.push(...findTextRanges(article, q))
    }
    if (ranges.length > 0) highlightRangesByCommentId.set(c.id, ranges)
  }
  applyHighlights()
}

function applyHighlights() {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return
  ;(CSS.highlights as Map<string, unknown>).delete(HIGHLIGHT_NAME)
  const all: Range[] = []
  for (const ranges of highlightRangesByCommentId.values()) all.push(...ranges)
  if (all.length === 0) return
  try {
    const hl = new (window as any).Highlight(...all)
    ;(CSS.highlights as Map<string, unknown>).set(HIGHLIGHT_NAME, hl)
  } catch {
    // CSS Custom Highlight API not available; skip silently
  }
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

  const writeAndToast = () => {
    const giscus = document.querySelector(".giscus")
    if (giscus) {
      giscus.scrollIntoView({ behavior: "smooth", block: "start" })
    }
    showToast("Quote copied. Paste it into the comment box below (⌘/Ctrl + V).")
  }

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(quoted).then(writeAndToast).catch(writeAndToast)
  } else {
    // Fallback: temporary textarea
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
    writeAndToast()
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

document.addEventListener("nav", () => {
  const sidebar = document.querySelector(".comment-sidebar") as HTMLElement | null
  if (!sidebar) return

  // If the page disables comments (no .giscus container present), hide the sidebar.
  if (!document.querySelector(".giscus")) {
    sidebar.style.display = "none"
    return
  }

  const cleanups: Array<() => void> = []

  const onMessage = (event: MessageEvent) => {
    if (!isGiscusMessage(event)) return
    const payload = (event.data as any).giscus
    // Discussion payload shape: { discussion: {...}, comments: [...] } via emit-metadata
    if (payload?.discussion && Array.isArray(payload?.comments)) {
      lastDiscussionData = payload as GiscusDiscussionData
      renderSidebar(lastDiscussionData)
      rebuildHighlights(lastDiscussionData)
      return
    }
    // Older / metadata-only payload: { discussion, viewer } — render header counts only
    if (payload?.discussion && payload?.viewer) {
      const meta = payload as GiscusMetadata
      const list = document.querySelector(SIDEBAR_LIST_SELECTOR) as HTMLElement | null
      if (list && list.getAttribute("data-empty") === "true" && meta.discussion.totalCommentCount === 0) {
        list.innerHTML =
          '<li class="comment-sidebar-empty">No comments yet. Select text or scroll down to start the conversation.</li>'
      }
    }
  }

  window.addEventListener("message", onMessage)
  cleanups.push(() => window.removeEventListener("message", onMessage))

  setupSelectionUI(cleanups)

  if (lastDiscussionData) {
    renderSidebar(lastDiscussionData)
    rebuildHighlights(lastDiscussionData)
  }

  window.addCleanup(() => {
    cleanups.forEach((fn) => fn())
  })
})

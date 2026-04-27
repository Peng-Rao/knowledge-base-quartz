import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
// @ts-ignore
import script from "./scripts/commentSidebar.inline"
import style from "./styles/commentSidebar.scss"

const CommentSidebar: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
  return (
    <div class={classNames(displayClass, "comment-sidebar")}>
      <h3>Comments</h3>
      <p class="comment-sidebar-hint">
        Select any text in the article to quote it in a new comment.
      </p>
      <ul class="comment-sidebar-list" data-empty="true">
        <li class="comment-sidebar-empty">Loading…</li>
      </ul>
    </div>
  )
}

CommentSidebar.afterDOMLoaded = script
CommentSidebar.css = style

export default (() => CommentSidebar) satisfies QuartzComponentConstructor

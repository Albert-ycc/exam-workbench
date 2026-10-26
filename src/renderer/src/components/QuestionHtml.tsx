// 显示题目内容：先净化再渲染。题目 HTML 来自第三方网页，任何地方显示题目都必须经过这里或 sanitizeQuestionHtml。
import DOMPurify from 'dompurify'
import { fillQuestionNumbers } from '@shared/numbering'
import './QuestionHtml.css'

export function sanitizeQuestionHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    // 只允许本地图片协议与内嵌图片；外部链接、脚本、表单一律去掉
    ALLOWED_URI_REGEXP: /^(?:ewb-asset:\/\/|data:image\/(?:png|jpeg|gif|webp|svg\+xml);)/i,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta'],
    FORBID_ATTR: ['style', 'class', 'id', 'onerror', 'onload'],
    // DOMPurify 会用 ALLOWED_URI_REGEXP 校验所有非安全属性的值；这些属性是数字或标记，不是地址
    ADD_URI_SAFE_ATTR: ['width', 'height', 'colspan', 'rowspan', 'data-ewb-qno', 'data-role']
  })
}

interface Props {
  html: string
  firstNo?: number // 传入时把小题号占位符替换成实际题号
  className?: string
}

export default function QuestionHtml({ html, firstNo, className }: Props) {
  const filled = firstNo != null ? fillQuestionNumbers(html, firstNo) : html
  return <div className={`question-html${className ? ` ${className}` : ''}`} dangerouslySetInnerHTML={{ __html: sanitizeQuestionHtml(filled) }} />
}

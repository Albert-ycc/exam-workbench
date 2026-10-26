// QuestionHtml 每次渲染都会重新净化一遍；列表很长又要频繁刷新（拖动时）的地方用这个，内容不变就不重算
import { memo } from 'react'
import QuestionHtml from '../QuestionHtml'

export default memo(QuestionHtml)

import { FlowDocumentJSON } from './typings'

/** 全新空白画布：只有 start 和 end，无任何业务节点。 */
export const initialData: FlowDocumentJSON = {
  nodes: [
    { id: 'start', type: 'start', meta: { position: { x: 400, y: 100 } }, data: { title: '开始' } },
    { id: 'end', type: 'end', meta: { position: { x: 400, y: 400 } }, data: { title: '结束' } },
  ],
  edges: [{ sourceNodeID: 'start', sourcePortID: 'out', targetNodeID: 'end' }],
}

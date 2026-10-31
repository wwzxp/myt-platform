import type { UiNode } from '@myt/device';
export interface Point {
    x: number;
    y: number;
}
/** 带边界的命中结果（区号列表等需要约束点击范围）。 */
export interface BoundedPoint extends Point {
    bounds: [number, number, number, number];
    text: string;
}
/** 取路径末节点；任一级越界返回 null。 */
export declare function nodeAtPath(root: UiNode, path: number[]): UiNode | null;
//# sourceMappingURL=paths.d.ts.map
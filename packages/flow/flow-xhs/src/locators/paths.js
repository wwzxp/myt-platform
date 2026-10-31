/** 取路径末节点；任一级越界返回 null。 */
export function nodeAtPath(root, path) {
    let current = root;
    // root 自身是第一级，所以从第 1 位开始走子节点。
    for (const index of path.slice(1)) {
        const child = current.children[index];
        if (!child)
            return null;
        current = child;
    }
    return current;
}
//# sourceMappingURL=paths.js.map
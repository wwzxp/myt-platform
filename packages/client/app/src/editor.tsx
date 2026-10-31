/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DockedPanelLayer } from '@flowgram.ai/panel-manager-plugin';
import { EditorRenderer, FreeLayoutEditorProvider } from '@flowgram.ai/free-layout-editor';

import '@flowgram.ai/free-layout-editor/index.css';
import './styles/index.css';
import { nodeRegistries } from './nodes';
import { useEditorProps } from './hooks';
import { WorkflowContext, type WorkflowContextValue } from './context/workflow-context';
import { loadWorkflow, saveWorkflow } from './services/workflow-api';
import { WorkflowPicker } from './components/workflow-picker';
import type { FlowDocumentJSON } from './typings';

/** 从 URL 读当前流程：`?flow=文件名.json`。 */
function currentFileName(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = new URLSearchParams(window.location.search).get('flow');
  return value ?? undefined;
}

/**
 * 编辑器。
 *
 * **只有一种模式**：`?flow=文件名.json` 从内核加载并自动保存。
 * 不带参数时不做猜测、不回落到演示数据——提示用户先选一个流程。
 */
export const Editor = () => {
  const fileName = currentFileName();
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [saveState, setSaveState] = useState<WorkflowContextValue['saveState']>('idle');
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  /** 保存中标记：避免并发写同一个文件。 */
  const saving = useRef(false);
  /**
   * 加载完成时间。
   *
   * 画布初始化时会触发 `onContentChange`（把加载的数据当成「变更」），
   * 若不加抑制，会用初始位置覆盖磁盘上用户的改动——实测踩过：
   * 拖动节点 → 自动保存成功 → 刷新页面 → 磁盘被重置回初始位置。
   * 加载后 2s 内忽略自动保存。
   */
  const loadedAt = useRef(0);
  /**
   * 上一次保存成功的内容指纹。
   *
   * 画布初始化、`document.toJSON()` 的字段顺序抖动都会产生「看起来变了」的内容；
   * 用 JSON 字符串比对可避免无意义的写盘（也顺带挡住初始化覆盖）。
   */
  const lastSaved = useRef<string>('');

  // 从内核加载
  useEffect(() => {
    if (!fileName) return;
    let cancelled = false;
    void loadWorkflow(fileName)
      .then((loaded) => {
        if (cancelled) return;
        setDoc(loaded);
        loadedAt.current = Date.now();
        lastSaved.current = JSON.stringify(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [fileName]);

  const save = useCallback(
    async (next: Record<string, unknown>) => {
      if (!fileName || saving.current) return;
      // 刚加载完的 2s 内忽略：那是画布初始化，不是用户改动
      if (Date.now() - loadedAt.current < 2000) return;
      // 内容没变就不写盘（幂等）
      const snapshot = JSON.stringify(next);
      if (snapshot === lastSaved.current) return;

      saving.current = true;
      setSaveState('saving');
      try {
        await saveWorkflow(fileName, next);
        lastSaved.current = snapshot;
        setSaveState('saved');
        setSaveError(undefined);
      } catch (error) {
        setSaveState('error');
        setSaveError(error instanceof Error ? error.message : String(error));
        console.error('保存失败：', error);
      } finally {
        saving.current = false;
      }
    },
    [fileName],
  );

  const contextValue = useMemo<WorkflowContextValue>(
    () => ({
      fileName: fileName as string,
      // 没选流程时也要能渲染：下面虽然有 `if (!fileName)` 守卫，但 useMemo
      // 在守卫之前执行，直接 replace 会在首屏就抛错、整页白屏。
      name: fileName ? fileName.replace(/\.json$/u, '') : '',
      saveState,
      ...(saveError === undefined ? {} : { saveError }),
      save: () => save(doc ?? {}),
    }),
    [fileName, saveState, saveError, save, doc],
  );

  const editorProps = useEditorProps(
    (doc ?? { nodes: [], edges: [] }) as unknown as FlowDocumentJSON,
    nodeRegistries,
    save,
  );

  // 没有指定流程：列出可选的流程，让用户点进去（不再让人手拼文件名）
  if (!fileName) {
    return <WorkflowPicker />;
  }

  if (loadError) {
    return (
      <div style={{ padding: 24 }}>
        <p>加载失败：{loadError}</p>
        <p>
          返回<a href="/workflows">流程列表</a>
        </p>
      </div>
    );
  }

  // 加载中先不渲染画布，避免用空数据初始化后覆盖磁盘上的图
  if (doc === null) {
    return <div style={{ padding: 24 }}>加载中…</div>;
  }

  return (
    <WorkflowContext.Provider value={contextValue}>
      <div className="doc-free-feature-overview">
        <FreeLayoutEditorProvider {...editorProps}>
          <div className="demo-container">
            <DockedPanelLayer>
              <EditorRenderer className="demo-editor" />
            </DockedPanelLayer>
          </div>
        </FreeLayoutEditorProvider>
      </div>
    </WorkflowContext.Provider>
  );
};

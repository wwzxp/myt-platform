/**
 * 流程选择页。
 *
 * 打开画布时没带 `?flow=` 就显示这个列表——否则用户只能靠记文件名手拼 URL。
 * 数据来自 `/api/workflows`（一图一文件，文件名即流程名）。
 */
import { useEffect, useState } from 'react';

import { Button, Input } from '@douyinfe/semi-ui';

import {
  createWorkflow,
  deleteWorkflow,
  listWorkflows,
  type WorkflowSummary,
} from '../../services/workflow-api';

/** 一行流程的展示时间（近的就显示相对时间）。 */
function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const diffMinutes = Math.floor((Date.now() - ms) / 60000);
  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  if (diffMinutes < 60 * 24) return `${Math.floor(diffMinutes / 60)} 小时前`;
  return new Date(ms).toLocaleDateString();
}

export const WorkflowPicker = () => {
  const [flows, setFlows] = useState<WorkflowSummary[] | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  /** 重新拉列表；新建/删除后调用。 */
  const reload = () => {
    listWorkflows()
      .then((rows) => {
        setFlows(rows);
        setError(undefined);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(reload, []);

  /** 新建流程并直接进去编辑。 */
  const onCreate = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const created = await createWorkflow(name);
      window.location.search = `?flow=${encodeURIComponent(created.fileName)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  /** 删除流程；需要二次确认，删的是磁盘文件不可恢复。 */
  const onDelete = async (flow: WorkflowSummary) => {
    if (busy) return;
    if (!window.confirm(`删除流程「${flow.name}」？文件会从磁盘移除，无法恢复。`)) return;
    setBusy(true);
    try {
      await deleteWorkflow(flow.fileName);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const wrap: React.CSSProperties = { padding: 32, maxWidth: 720, margin: '0 auto' };

  if (error) {
    return (
      <div style={wrap}>
        <h2 style={{ marginBottom: 8 }}>读取流程列表失败</h2>
        <p style={{ color: '#c0392b' }}>{error}</p>
        <p style={{ opacity: 0.65 }}>
          确认内核已启动。开发时用 <code>pnpm dev:canvas</code> 打开本页（它会一并拉起内核并代理
          <code>/api</code>）。
        </p>
      </div>
    );
  }

  if (flows === null) {
    return (
      <div style={wrap}>
        <p>加载中…</p>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <h2 style={{ marginBottom: 4 }}>选择流程</h2>
      <p style={{ opacity: 0.65, marginTop: 0, marginBottom: 20 }}>
        流程文件保存在 <code>data/workflows/</code>，文件名即流程名。
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <Input
          value={newName}
          onChange={(v) => setNewName(String(v))}
          onEnterPress={onCreate}
          placeholder="新流程名称"
          style={{ flex: 1 }}
        />
        <Button theme="solid" onClick={onCreate} loading={busy} disabled={!newName.trim()}>
          新建流程
        </Button>
      </div>

      {flows.length === 0 ? (
        <p>还没有流程。在 <code>data/workflows/</code> 下新建一个 <code>.json</code> 文件后刷新本页。</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {flows.map((flow) => (
            <li
              key={flow.fileName}
              style={{
                border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 8,
                padding: '12px 16px',
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <a
                href={`?flow=${encodeURIComponent(flow.fileName)}`}
                style={{ fontSize: 15, fontWeight: 500, color: '#2b6cb0', textDecoration: 'none' }}
              >
                {flow.name}
              </a>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, opacity: 0.6 }}>
                  {flow.nodeCount} 个节点 · {formatTime(flow.updatedAt)}
                </span>
                <Button
                  size="small"
                  type="danger"
                  theme="borderless"
                  onClick={() => onDelete(flow)}
                  disabled={busy}
                >
                  删除
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

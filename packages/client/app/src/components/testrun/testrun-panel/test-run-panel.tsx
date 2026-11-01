/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FC, useState, useEffect } from 'react';

import classnames from 'classnames';
import { WorkflowInputs, WorkflowOutputs } from '@flowgram.ai/runtime-interface';
import { useService } from '@flowgram.ai/free-layout-editor';
import { Button, Select, Switch } from '@douyinfe/semi-ui';
import { IconClose, IconPlay, IconSpin } from '@douyinfe/semi-icons';

import { TestRunJsonInput } from '../testrun-json-input';
import { TestRunForm } from '../testrun-form';
import { NodeStatusGroup } from '../node-status-bar/group';
import { WorkflowRuntimeService } from '../../../plugins/runtime-plugin/runtime-service';
import { useTestRunFormPanel } from '../../../plugins/panel-manager-plugin/hooks';
import { IconCancel } from '../../../assets/icon-cancel';
import { listSelectableDevices, type SelectableDevice } from '../../../services/device-api';

import styles from './index.module.less';

export interface TestRunSidePanelProps {}

export const TestRunSidePanel: FC<TestRunSidePanelProps> = () => {
  const runtimeService = useService(WorkflowRuntimeService);
  const { close: closePanel } = useTestRunFormPanel();
  const [isRunning, setRunning] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  /** 试跑目标设备；没有它就驱动不了手机，后端会直接拒绝。 */
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [devices, setDevices] = useState<SelectableDevice[]>([]);
  const [deviceError, setDeviceError] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<string[]>();
  const [result, setResult] = useState<
    | {
        inputs: WorkflowInputs;
        outputs: WorkflowOutputs;
      }
    | undefined
  >();

  // en - Use localStorage to persist the JSON mode state
  const [inputJSONMode, _setInputJSONMode] = useState(() => {
    const savedMode = localStorage.getItem('testrun-input-json-mode');
    return savedMode ? JSON.parse(savedMode) : false;
  });

  const setInputJSONMode = (checked: boolean) => {
    _setInputJSONMode(checked);
    localStorage.setItem('testrun-input-json-mode', JSON.stringify(checked));
  };

  // 面板打开时拉一次设备列表：运行中的容器才有 ADB 端点。
  useEffect(() => {
    let alive = true;
    listSelectableDevices()
      .then((rows) => {
        if (!alive) return;
        setDevices(rows);
        setDeviceId((current) => current ?? rows[0]?.serial);
        setDeviceError(undefined);
      })
      .catch((error: unknown) => {
        if (alive) setDeviceError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
    };
  }, []);

  const onTestRun = async () => {
    if (isRunning) {
      await runtimeService.taskCancel();
      return;
    }
    setResult(undefined);
    setErrors(undefined);
    const taskID = await runtimeService.taskRun({ ...values, ...(deviceId ? { deviceId } : {}) });
    if (taskID) {
      setRunning(true);
    }
  };

  const onClose = async () => {
    await runtimeService.taskCancel();
    setValues({});
    setRunning(false);
    closePanel();
  };

  const renderRunning = (
    <div className={styles['testrun-panel-running']}>
      <IconSpin spin size="large" />
      <div className={styles.text}>运行中…</div>
    </div>
  );

  const renderForm = (
    <div className={styles['testrun-panel-form']}>
      {/* 设备选择：流程必须在某台手机上跑，没有设备后端拿不到 ADB 端点 */}
      <div className={styles['device-picker']}>
        <div className={styles.title}>目标设备</div>
        <Select
          value={deviceId}
          onChange={(v) => setDeviceId(v === undefined || v === null ? undefined : String(v))}
          optionList={devices.map((d) => ({
            value: d.serial,
            label: `${d.name}（${d.serial}）`,
          }))}
          placeholder={devices.length === 0 ? '没有运行中的设备' : '请选择设备'}
          emptyContent="没有运行中的设备"
          style={{ width: '100%' }}
          disabled={devices.length === 0}
        />
        <div className={styles.hint}>只列出运行中的容器（未运行没有 ADB 端点）</div>
        {deviceError ? <div className={styles.error}>{deviceError}</div> : null}
      </div>
      <div className={styles['testrun-panel-input']}>
        <div className={styles.title}>输入参数</div>
        <div title="开关打开后直接用 JSON 编辑参数，适合粘贴整段配置">JSON 模式</div>
        <Switch
          checked={inputJSONMode}
          onChange={(checked: boolean) => setInputJSONMode(checked)}
          size="small"
        />
      </div>
      {inputJSONMode ? (
        <TestRunJsonInput values={values} setValues={setValues} />
      ) : (
        <TestRunForm values={values} setValues={setValues} />
      )}
      {errors?.map((e) => (
        <div className={styles.error} key={e}>
          {e}
        </div>
      ))}
      <NodeStatusGroup title="输入结果" data={result?.inputs} optional disableCollapse />
      <NodeStatusGroup title="输出结果" data={result?.outputs} optional disableCollapse />
    </div>
  );

  const renderButton = (
    <Button
      onClick={onTestRun}
      icon={isRunning ? <IconCancel /> : <IconPlay size="small" />}
      className={classnames(styles.button, {
        [styles.running]: isRunning,
        [styles.default]: !isRunning,
      })}
    >
      {isRunning ? '取消' : '试运行'}
    </Button>
  );

  useEffect(() => {
    const disposer = runtimeService.onResultChanged(({ result, errors }) => {
      setRunning(false);
      setResult(result);
      if (errors) {
        setErrors(errors);
      } else {
        setErrors(undefined);
      }
    });
    return () => disposer.dispose();
  }, []);

  useEffect(
    () => () => {
      runtimeService.taskCancel();
    },
    [runtimeService]
  );

  return (
    <div className={styles['testrun-panel-container']}>
      <div className={styles['testrun-panel-header']}>
        <div className={styles['testrun-panel-title']} title="在这台设备上把当前画布跑一遍，不发布也不改数据">
          试运行
        </div>
        <Button
          className={styles['testrun-panel-title']}
          type="tertiary"
          icon={<IconClose />}
          size="small"
          theme="borderless"
          onClick={onClose}
        />
      </div>
      <div className={styles['testrun-panel-content']}>
        {isRunning ? renderRunning : renderForm}
      </div>
      <div className={styles['testrun-panel-footer']}>{renderButton}</div>
    </div>
  );
};

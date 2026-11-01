/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import React, { useCallback } from 'react';

import { DisplaySchemaTag } from '@flowgram.ai/form-materials';
import { Typography, Tooltip } from '@douyinfe/semi-ui';

import './index.css';

const { Text } = Typography;

interface FormItemProps {
  children: React.ReactNode;
  name: string;
  /**
   * 界面上显示的中文名。
   *
   * `name` 同时是字段名/端口名（引擎按它路由），不能直接改成中文；
   * 需要中文标签时单独给这个，缺省仍然显示 `name`。
   */
  label?: string;
  /** 标签上的悬浮说明（原生 `title`）；长解释放这里，不要塞在表单里。 */
  title?: string;
  type?: string;
  required?: boolean;
  description?: string;
  labelWidth?: number;
  labelStyle?: React.CSSProperties;
  vertical?: boolean;
  style?: React.CSSProperties;
}
export function FormItem({
  children,
  name,
  label,
  title,
  required,
  description,
  type,
  labelWidth,
  labelStyle,
  vertical,
  style,
}: FormItemProps): JSX.Element {
  const renderTitle = useCallback(
    (showTooltip?: boolean) => (
      <div style={{ width: '0', display: 'flex', flex: '1' }}>
        <Text
          style={{ width: '100%', cursor: title ? 'help' : undefined }}
          ellipsis={{ showTooltip: !!showTooltip }}
          {...(title ? { title } : {})}
        >
          {label ?? name}
          {required && <span style={{ color: '#f93920', paddingLeft: '2px' }}>*</span>}
        </Text>
      </div>
    ),
    []
  );
  return (
    <div
      style={{
        fontSize: 12,
        marginBottom: 6,
        width: '100%',
        position: 'relative',
        display: 'flex',
        gap: 8,
        ...(vertical
          ? { flexDirection: 'column' }
          : {
              justifyContent: 'center',
              alignItems: 'center',
            }),
        ...style,
      }}
    >
      <div
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          color: 'var(--semi-color-text-0)',
          width: labelWidth || 118,
          minWidth: labelWidth || 118,
          maxWidth: labelWidth || 118,
          position: 'relative',
          display: 'flex',
          columnGap: 4,
          flexShrink: 0,
          ...labelStyle,
        }}
      >
        {type && <DisplaySchemaTag value={{ type }} />}
        {description ? <Tooltip content={description}>{renderTitle()}</Tooltip> : renderTitle(true)}
      </div>

      <div
        style={{
          flexGrow: 1,
          minWidth: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

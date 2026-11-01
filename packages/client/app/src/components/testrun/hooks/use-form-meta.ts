/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useMemo } from 'react';

import { useService, WorkflowDocument } from '@flowgram.ai/free-layout-editor';
import { IJsonSchema, JsonSchemaBasicType } from '@flowgram.ai/form-materials';

import { TestRunFormMetaItem } from '../testrun-form/type';
import { WorkflowNodeType } from '../../../nodes';

const DEFAULT_DECLARE: IJsonSchema = {
  type: 'object',
  properties: {},
};

export const useFormMeta = (): TestRunFormMetaItem[] => {
  const document = useService(WorkflowDocument);

  const startNode = useMemo(
    () => document.root.blocks.find((node) => node.flowNodeType === WorkflowNodeType.Start),
    [document]
  );

  const workflowInputs = startNode?.form?.getValueIn<IJsonSchema>('outputs') || DEFAULT_DECLARE;

  // Add state for form values
  const formMeta = useMemo(() => {
    const formFields: TestRunFormMetaItem[] = [];
    Object.entries(workflowInputs.properties!).forEach(([name, property]) => {
      formFields.push({
        type: property.type as JsonSchemaBasicType,
        name,
        // 参数声明里的中文名优先，界面不该把 imagePaths 这种键名丢给用户。
        ...(property.title ? { title: property.title } : {}),
        defaultValue: property.default,
        required: workflowInputs.required?.includes(name) ?? false,
        itemsType: property.items?.type as JsonSchemaBasicType,
      });
    });
    return formFields;
  }, [workflowInputs]);

  return formMeta;
};

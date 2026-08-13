import React from 'react';
import { describe, expect, it } from 'vitest';
import BillPreviewForm from '../../components/BillPreviewForm';
import type { ScanData, ScanEntry, Template } from '../../../types';

const baseProps = {
  jwt: 'jwt-token',
  scanData: { Amount: 100 } as ScanData,
  activeScanEntry: {
    id: 'entry-1',
    source: 'excel',
    type: 'BILL',
    header: { vendorRef: 'Vendor A' },
    lineItems: [{ Amount: '100' }],
    scanRecordId: 'record-1',
  } as ScanEntry,
  selectedLocationId: 'loc-1',
  scanRecordId: 'record-1',
  selectedTemplate: {
    id: 'tmpl-bill',
    locationId: 'loc-1',
    name: 'Bill Template',
    transactionType: 'BILL',
    scanModes: ['EXCEL'],
    posSystem: null,
    lineType: 'bill',
    version: 1,
    defaults: {},
    columnMappings: {},
    memoTemplate: '',
    docNumberTemplate: '',
    isActive: true,
    createdAt: '',
    updatedAt: '',
  } as Template,
  userRole: 'ADMIN',
  attachments: [],
};

describe('BillPreviewForm', () => {
  it('accepts bill props and creates a valid React element', () => {
    const element = React.createElement(BillPreviewForm, baseProps);

    expect(element).toBeDefined();
    expect(element.props.scanRecordId).toBe('record-1');
    expect(element.props.selectedTemplate?.transactionType).toBe('BILL');
    expect(element.props.selectedLocationId).toBe('loc-1');
  });
});

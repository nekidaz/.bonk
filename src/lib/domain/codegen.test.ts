import { describe, expect, it } from 'vitest';
import { generateGrpcurl } from './codegen';
import type { Tab } from './types';

function grpcTab(overrides: Partial<NonNullable<Tab['grpc']>> = {}): Tab {
  return {
    id: 'grpc-tab',
    protocol: 'grpc',
    title: 'gRPC',
    request: { method: 'GRPC', url: '', headers: {} },
    grpc: {
      endpoint: '{{host}}:443',
      plaintext: false,
      method: 'partner.v1.PartnerService.GetPartner',
      message: '{"id":"{{id}}"}',
      metadata: { authorization: 'Bearer {{token}}' },
      ...overrides,
    },
  };
}

describe('generateGrpcurl', () => {
  it('includes resolved endpoint, method, message, and metadata', () => {
    const command = generateGrpcurl(grpcTab(), {
      host: 'api.example.com',
      id: '42',
      token: 'secret',
    });

    expect(command).toContain("-H \\\n  'authorization: Bearer secret'");
    expect(command).toContain("-d \\\n  '{\"id\":\"42\"}'");
    expect(command).toContain('api.example.com:443');
    expect(command).toContain('partner.v1.PartnerService/GetPartner');
    expect(command).not.toContain('-plaintext');
  });

  it('renders a blank draft as an empty protobuf message and honors plaintext', () => {
    const command = generateGrpcurl(grpcTab({ endpoint: 'http://localhost:9090', plaintext: true, message: '' }));

    expect(command).toContain('-plaintext');
    expect(command).toContain("-d \\\n  '{}'");
    expect(command).toContain('localhost:9090');
  });
});

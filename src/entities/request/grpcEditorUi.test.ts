import { describe, expect, it } from 'vitest';
import { filterGrpcServices } from './grpcEditorUi.svelte';
import type { GrpcService } from '$shared/model';

const services: GrpcService[] = [
  {
    name: 'employee.EmployeeService',
    methods: [
      { name: 'CreateEmployee', symbol: 'employee.EmployeeService/CreateEmployee' },
      { name: 'GetEmployee', symbol: 'employee.EmployeeService/GetEmployee' },
    ],
  },
  {
    name: 'shepbb.ShepService',
    methods: [
      { name: 'GenerateDigitalSign', symbol: 'shepbb.ShepService/GenerateDigitalSign' },
      { name: 'CheckCompanyELicense', symbol: 'shepbb.ShepService/CheckCompanyELicense' },
    ],
  },
];

describe('filterGrpcServices', () => {
  it('returns the original list for an empty query', () => {
    expect(filterGrpcServices(services, '   ')).toBe(services);
  });

  it('keeps every method when the service matches', () => {
    expect(filterGrpcServices(services, 'shepservice')).toEqual([services[1]]);
  });

  it('retains only matching methods inside their service', () => {
    const result = filterGrpcServices(services, 'create employee');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('employee.EmployeeService');
    expect(result[0].methods.map((method) => method.name)).toEqual(['CreateEmployee']);
  });

  it('matches package-qualified protobuf symbols case-insensitively', () => {
    const result = filterGrpcServices(services, 'SHEPBB digital');
    expect(result[0].methods.map((method) => method.name)).toEqual(['GenerateDigitalSign']);
  });

  it('removes services without a match', () => {
    expect(filterGrpcServices(services, 'missing')).toEqual([]);
  });
});

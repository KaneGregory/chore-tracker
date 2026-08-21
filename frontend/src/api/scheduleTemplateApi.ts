import { apiRequest } from './httpClient';
import type { CreateScheduleTemplateInput, ScheduleTemplate } from '../types/scheduleTemplate';

export async function listScheduleTemplates(householdId: number): Promise<ScheduleTemplate[]> {
  const response = await apiRequest<{ scheduleTemplates: ScheduleTemplate[] }>(
    `/api/households/${householdId}/schedule-templates`,
  );
  return response.scheduleTemplates;
}

export async function createScheduleTemplate(
  householdId: number,
  input: CreateScheduleTemplateInput,
): Promise<ScheduleTemplate> {
  const response = await apiRequest<{ scheduleTemplate: ScheduleTemplate }>(
    `/api/households/${householdId}/schedule-templates`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.scheduleTemplate;
}

export async function removeScheduleTemplate(
  householdId: number,
  scheduleTemplateId: number,
): Promise<void> {
  await apiRequest<void>(`/api/households/${householdId}/schedule-templates/${scheduleTemplateId}`, {
    method: 'DELETE',
  });
}

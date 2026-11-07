import type { Channel } from './channel';
import { MissingTemplateVariableError, TemplateNotFoundError } from './errors';

export type TemplateVariables = Readonly<Record<string, string | number>>;

export interface Template {
  readonly subject?: string;
  /** Text with `{{name}}` placeholders. */
  readonly body: string;
}

export interface RenderedTemplate {
  readonly subject?: string;
  readonly body: string;
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * One template per (id, channel): the same "order-shipped" event reads as a
 * full email, a 160-character SMS and a one-line push. Rendering is strict: a
 * missing variable is an error, never a literal "{{name}}" sent to a customer.
 */
export class TemplateRegistry {
  private readonly templates = new Map<string, Template>();

  register(templateId: string, channel: Channel, template: Template): this {
    this.templates.set(`${templateId}:${channel}`, template);
    return this;
  }

  render(templateId: string, channel: Channel, variables: TemplateVariables): RenderedTemplate {
    const template = this.templates.get(`${templateId}:${channel}`);
    if (!template) throw new TemplateNotFoundError(templateId, channel);
    const missing = new Set<string>();
    const fill = (text: string): string =>
      text.replace(PLACEHOLDER, (_match, name: string) => {
        const value = variables[name];
        if (value === undefined) {
          missing.add(name);
          return '';
        }
        return String(value);
      });
    const body = fill(template.body);
    const subject = template.subject !== undefined ? fill(template.subject) : undefined;
    if (missing.size > 0) throw new MissingTemplateVariableError(templateId, [...missing]);
    return subject !== undefined ? { subject, body } : { body };
  }
}

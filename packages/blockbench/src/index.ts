import { parseFXL } from '../../core/src/dsl.js';
import { exportBBModel } from '../../core/src/bbmodel.js';
declare const Plugin: { register(id: string, options: Record<string, unknown>): void };
declare class Action {
  constructor(id: string, options: Record<string, unknown>);
  delete(): void;
}
interface Form {
  source: string;
  prompt: string;
  provider: string;
  model: string;
}
declare class Dialog {
  constructor(options: Record<string, unknown>);
  getFormResult(): Form;
  setFormValues(values: Partial<Form>): void;
  show(): void;
}
declare const MenuBar: { addAction(action: Action, path: string): void };
declare const Blockbench: {
  showQuickMessage(message: string): void;
  showMessageBox(options: { title: string; message: string }): void;
  export(options: Record<string, unknown>): void;
  import(options: Record<string, unknown>, callback: (files: { content: string }[]) => void): void;
};
declare const Codecs: {
  project: { load(model: Record<string, unknown>, file: { path: string; no_file: boolean }): void };
};
declare const Project: { name: string };
let action: Action | undefined;
const example =
  'model "Formixel Model"\ntexture 32 32\nmaterial moss "#517f38"\ngroup body {\n cube torso [-4,0,-2] [8,12,4] material moss\n}\n';
export function buildInBlockbench(source: string): void {
  const model = parseFXL(source);
  const compiled = exportBBModel(model); // Full validation before touching the editor.
  Codecs.project.load(compiled, { path: 'formixel.bbmodel', no_file: true });
  Project.name = model.name;
  Blockbench.showQuickMessage(`Formixel: ${model.cubes.length} cubes built`);
}
Plugin.register('formixel', {
  title: 'Formixel',
  author: 'Formixel contributors',
  description:
    'Compile FXL with textures and animations locally; plan with Codex CLI or Claude Code externally.',
  icon: 'view_in_ar',
  version: '1.1.0',
  variant: 'both',
  min_version: '5.0.0',
  onload() {
    action = new Action('formixel_panel', {
      name: 'Formixel',
      icon: 'view_in_ar',
      click() {
        const dialog = new Dialog({
          id: 'formixel_panel',
          title: 'Formixel',
          width: 700,
          form: {
            source: { label: 'FXL source', type: 'textarea', value: example },
            prompt: { label: 'Task description', type: 'text' },
            provider: {
              label: 'Planner',
              type: 'select',
              options: {
                codex: 'Codex CLI',
                'claude-code': 'Claude Code',
                openai: 'OpenAI API (optional)',
                anthropic: 'Anthropic API (optional)',
              },
              value: 'codex',
            },
            model: { label: 'Model (required for API)', type: 'text' },
          },
          buttons: ['Build FXL', 'Load FXL', 'Export task', 'Close'],
          onButton(index: number) {
            const form = dialog.getFormResult();
            try {
              if (index === 0) buildInBlockbench(form.source);
              if (index === 1) {
                Blockbench.import(
                  { type: 'Formixel source', extensions: ['fxl', 'bbscript'], readtype: 'text' },
                  (files) => {
                    if (files[0]) dialog.setFormValues({ source: files[0].content });
                  },
                );
                return false;
              }
              if (index === 2) {
                if (!form.prompt?.trim()) throw new Error('Enter a task description');
                if (['openai', 'anthropic'].includes(form.provider) && !form.model?.trim())
                  throw new Error('Choose an explicit API model');
                Blockbench.export({
                  type: 'Formixel task',
                  extensions: ['json'],
                  name: 'formixel.task',
                  content: JSON.stringify(
                    {
                      version: 1,
                      prompt: form.prompt,
                      provider: form.provider,
                      ...(form.model?.trim() ? { model: form.model.trim() } : {}),
                    },
                    null,
                    2,
                  ),
                });
              }
            } catch (e) {
              Blockbench.showMessageBox({
                title: 'Formixel validation failed',
                message: (e as Error).message,
              });
              return false;
            }
          },
        });
        dialog.show();
      },
    });
    MenuBar.addAction(action, 'tools');
  },
  onunload() {
    action?.delete();
    action = undefined;
  },
});

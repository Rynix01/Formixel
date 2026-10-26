import { parseFXL } from '../../core/src/dsl.js';
import { exportBBModel, importBBModel } from '../../core/src/bbmodel.js';
import { analyzeQuality } from '../../core/src/quality.js';
import { prepareRepair } from '../../core/src/repair.js';
import {
  authorDesign,
  parseDesignDocument,
  reviewModel,
  type DesignDocument,
} from '../../core/src/design.js';
import {
  parseAnatomyRoles,
  assertAnatomyReferences,
  type AnatomyRoles,
} from '../../core/src/policy.js';
import { serialize } from '../../core/src/model.js';
import {
  validateModelContext,
  rebindModelContext,
  exportBBModelWithContext,
  createModelContext,
  type ModelContext,
} from '../../core/src/context.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { decodePNG, encodePNG } from '../../core/src/png.js';
import type { Model } from '../../core/src/model.js';

declare const Plugin: { register(id: string, options: Record<string, unknown>): void };
declare class Action {
  constructor(id: string, options: Record<string, unknown>);
  delete(): void;
}
type Form = Record<string, any>;
declare class Dialog {
  constructor(options: Record<string, unknown>);
  getFormResult(): Form;
  setFormValues(values: Form): void;
  show(): void;
  hide(): void;
}
declare const MenuBar: { addAction(action: Action, path: string): void };
declare const Blockbench: {
  showQuickMessage(message: string): void;
  showMessageBox(options: { title: string; message: string }): void;
  export(options: Record<string, unknown>): void;
  import(
    options: Record<string, unknown>,
    callback: (files: { content: unknown; name?: string }[]) => void,
  ): void;
};
declare const Codecs: {
  project: {
    load(model: Record<string, unknown>, file: { path: string; no_file: boolean }): void;
    compile(options?: { raw: boolean; bitmaps: boolean }): unknown;
  };
};
declare const Project: { name: string };
declare const Outliner: { selected?: { uuid: string }[] };
declare const Group: { multi_selected?: { uuid: string }[] };
let action: Action | undefined;
let activeWorkspace: Dialog | undefined;
const workspaces = new Set<() => void>();
const example =
  'model "Formixel Model"\ntexture 32 32\nmaterial moss "#517f38"\ngroup body {\n cube torso [-4,0,-2] [8,12,4] material moss\n}\n';
const providers = {
  codex: 'Codex CLI',
  'claude-code': 'Claude Code',
  openai: 'OpenAI API (optional)',
  anthropic: 'Anthropic API (optional)',
};
const roles = {
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  top: 'Top',
  detail: 'Detail',
  texture: 'Texture / palette',
  storyboard: 'Animation storyboard',
};
const safeMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/[<>]/g, '').slice(0, 2048);
const showError = (error: unknown) =>
  Blockbench.showMessageBox({ title: 'Formixel validation failed', message: safeMessage(error) });
const byteLength = (text: string) => new TextEncoder().encode(text).length;
const fingerprint = (model: Model) =>
  Array.from(sha256(new TextEncoder().encode(serialize(model))))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
const plainObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function buildInBlockbench(source: string): void {
  const authored = source.trimStart().startsWith('{')
    ? authorDesign(JSON.parse(source))
    : undefined;
  if (authored && !authored.report.passed)
    throw new Error('Local design constraints failed; inspect the design before building');
  const model = authored?.model ?? parseFXL(source);
  Codecs.project.load(exportBBModel(model), { path: 'formixel.bbmodel', no_file: true });
  Project.name = model.name;
  Blockbench.showQuickMessage(`Formixel: ${model.cubes.length} cubes built`);
}

function snapshot() {
  if (typeof Codecs.project.compile !== 'function')
    throw new Error('The current editor cannot compile a project snapshot');
  // Match the editor's saved numerical precision; raw objects bypass its JSON serializer.
  // Embedding bitmaps keeps the snapshot independent of local texture paths.
  const compiled = Codecs.project.compile({ raw: false, bitmaps: true });
  const native: unknown = typeof compiled === 'string' ? JSON.parse(compiled) : compiled;
  const model = importBBModel(native); // Reject unsupported editor features before any remote job.
  return { native, model };
}
function selectedIDs(native: unknown, model: Model): string[] {
  const mapping = new Map<string, string>();
  const visit = (n: unknown) => {
    if (!plainObject(n)) return;
    if (typeof n.uuid === 'string')
      mapping.set(n.uuid, typeof n.formixel_id === 'string' ? n.formixel_id : n.uuid);
    if (Array.isArray(n.children)) n.children.forEach(visit);
  };
  if (plainObject(native))
    for (const key of ['groups', 'elements', 'outliner'])
      if (Array.isArray(native[key])) native[key].forEach(visit);
  const current = [
    ...(typeof Outliner !== 'undefined' && Array.isArray(Outliner.selected)
      ? Outliner.selected
      : []),
    ...(typeof Group !== 'undefined' && Array.isArray(Group.multi_selected)
      ? Group.multi_selected
      : []),
  ];
  const allowed = new Set([...model.groups, ...model.cubes].map((n) => n.id));
  const ids = [
    ...new Set(
      current.map((n) => mapping.get(n.uuid)).filter((id): id is string => !!id && allowed.has(id)),
    ),
  ];
  if (!ids.length) throw new Error('Select one or more supported parts in the outliner first');
  return ids.map((id) => 'node:' + id);
}
/** The editor preserves UUIDs while its project codec can discard semantic IDs. */
function editorIDMap(native: Record<string, unknown>, model: Model): Record<string, string> {
  const ids = new Set(
    [...model.groups, ...model.cubes, ...(model.animations ?? []), ...(model.textures ?? [])].map(
      (node) => node.id,
    ),
  );
  const mapping: Record<string, string> = Object.create(null);
  const visit = (value: unknown) => {
    if (!plainObject(value)) return;
    if (typeof value.formixel_id === 'string' && typeof value.uuid === 'string')
      mapping[value.formixel_id] = ids.has(value.formixel_id) ? value.formixel_id : value.uuid;
    if (Array.isArray(value.children)) value.children.forEach(visit);
  };
  for (const key of ['groups', 'elements', 'outliner', 'animations', 'textures'])
    if (Array.isArray(native[key])) native[key].forEach(visit);
  return mapping;
}
function base64(bytes: Uint8Array) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
async function referencePNG(content: unknown): Promise<Uint8Array> {
  let bytes: Uint8Array;
  if (content instanceof ArrayBuffer) bytes = new Uint8Array(content);
  else if (ArrayBuffer.isView(content))
    bytes = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  else throw new Error('The editor did not return PNG image bytes');
  if (
    bytes.length < 33 ||
    bytes.length > 4_000_000 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
  )
    throw new Error('Choose a PNG image up to 4 MB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    width = view.getUint32(16),
    height = view.getUint32(20);
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 8_000_000)
    throw new Error('Reference dimensions exceed the image budget');
  let animated = false;
  for (let at = 8; at + 12 <= bytes.length;) {
    const size = view.getUint32(at);
    if (size > bytes.length - at - 12) throw new Error('Malformed PNG image');
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) animated = true;
    at += size + 12;
  }
  if (animated) throw new Error('Choose a static PNG reference');
  let image: { width: number; height: number; pixels: Uint8Array };
  if (
    width <= 1024 &&
    height <= 1024 &&
    width * height <= 262144 &&
    [2, 6].includes(bytes[25]!) &&
    bytes[28] === 0
  )
    image = decodePNG(bytes);
  else {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined')
      throw new Error('Resize this reference to at most 512×512 RGB/RGBA PNG before importing');
    const bitmap = await createImageBitmap(
      new Blob([Uint8Array.from(bytes).buffer], { type: 'image/png' }),
    );
    try {
      const scale = Math.min(1, 512 / bitmap.width, 512 / bitmap.height),
        canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Image normalization is unavailable');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      image = {
        width: canvas.width,
        height: canvas.height,
        pixels: new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data),
      };
    } finally {
      bitmap.close();
    }
  }
  const normalized = encodePNG(image);
  if (normalized.length > 1_000_000) throw new Error('Normalized PNG exceeds 1 MB');
  return normalized;
}

function openWorkspace(initial: Form) {
  if (activeWorkspace) {
    activeWorkspace.show();
    return;
  }
  let endpoint = '',
    token = '',
    connected = false,
    disposed = false,
    job: string | undefined,
    running = false,
    submitting = false,
    reviewed = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    polls = 0,
    polling = false;
  let connectionVersion = 0;
  let result:
    | {
        native: Record<string, unknown>;
        model: Model;
        review: unknown;
        metrics: unknown;
        design?: DesignDocument;
        context?: ModelContext;
      }
    | undefined;
  type RigSidecar = { roles?: AnatomyRoles; constraints?: unknown; context?: ModelContext };
  let explicitRig: RigSidecar | undefined,
    appliedRig: (RigSidecar & { fingerprint: string }) | undefined;
  const controllers = new Set<AbortController>();
  const requestTimers = new Set<ReturnType<typeof setTimeout>>();
  const references: { role: string; pngBase64: string; name: string }[] = [];
  let dialog: Dialog;
  const status = (text: string) => {
    if (!disposed) dialog.setFormValues({ status: text });
  };
  const stopPolling = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    connectionVersion++;
    stopPolling();
    for (const c of controllers) c.abort();
    controllers.clear();
    for (const timer of requestTimers) clearTimeout(timer);
    requestTimers.clear();
    token = '';
    endpoint = '';
    connected = false;
    job = undefined;
    running = false;
    result = undefined;
    explicitRig = undefined;
    appliedRig = undefined;
    references.length = 0;
    dialog.setFormValues({ token: '', references: '', status: 'Disconnected' });
    workspaces.delete(dispose);
    if (activeWorkspace === dialog) activeWorkspace = undefined;
  };
  const request = async (path: string, method = 'GET', body?: unknown) => {
    if (!connected || disposed) throw new Error('Connect the local Formixel bridge first');
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    requestTimers.add(timeout);
    try {
      const text = body === undefined ? undefined : JSON.stringify(body);
      if (text !== undefined && byteLength(text) > 16_000_000)
        throw new Error('Model and references exceed the local bridge job limit');
      const response = await fetch(endpoint + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + token,
          ...(text !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(text !== undefined ? { body: text } : {}),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      const length = Number(response.headers.get('content-length') ?? 0);
      if (!Number.isSafeInteger(length) || length < 0 || length > 16_000_000)
        throw new Error('Bridge response is too large');
      let responseText = '';
      if (response.body?.getReader) {
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let count = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            count += value.length;
            if (count > 16_000_000) throw new Error('Bridge response is too large');
            responseText += decoder.decode(value, { stream: true });
          }
          responseText += decoder.decode();
        } finally {
          reader.releaseLock();
        }
      } else {
        responseText = await response.text();
        if (byteLength(responseText) > 16_000_000) throw new Error('Bridge response is too large');
      }
      const data: unknown = JSON.parse(responseText);
      if (!response.ok)
        throw new Error(
          plainObject(data) && typeof data.error === 'string'
            ? data.error
            : `Bridge request failed (${response.status})`,
        );
      return data;
    } finally {
      clearTimeout(timeout);
      requestTimers.delete(timeout);
      controllers.delete(controller);
    }
  };
  const connect = async () => {
    if (running || submitting)
      throw new Error('Cancel the current job before changing the connection');
    const form = dialog.getFormResult(),
      match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/.exec(
        String(form.endpoint ?? '').trim(),
      );
    if (!match || Number(match[1]) > 65535)
      throw new Error('Use the exact http://127.0.0.1:port address printed by Formixel');
    const nextToken = String(form.token ?? '')
      .trim()
      .toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(nextToken))
      throw new Error('Paste the 64-character pairing token printed by Formixel');
    const version = ++connectionVersion;
    for (const controller of controllers) controller.abort();
    endpoint = String(form.endpoint).trim().replace(/\/$/, '');
    token = nextToken;
    connected = true;
    result = undefined;
    reviewed = false;
    job = undefined;
    try {
      const data = await request('/health');
      if (disposed || version !== connectionVersion) return;
      if (!plainObject(data) || data.service !== 'Formixel' || data.protocol !== 1)
        throw new Error('This address is not a compatible Formixel bridge');
      status(
        data.active
          ? 'Connected. The bridge already has a running job.'
          : 'Connected. Ready to model.',
      );
    } catch (e) {
      if (version === connectionVersion) {
        connected = false;
        token = '';
      }
      throw e;
    }
  };
  const schedule = () => {
    stopPolling();
    if (!running || disposed) return;
    if (polls >= 600) {
      status('Monitoring paused after 15 minutes. Refresh status to continue.');
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      void poll().catch((e) => {
        stopPolling();
        status('Status unavailable. Refresh to retry.');
        showError(e);
      });
    }, 1500);
  };
  const poll = async () => {
    if (!job) throw new Error('No submitted job to inspect');
    if (polling) return;
    polling = true;
    stopPolling();
    const expected = job;
    try {
      const data = await request('/jobs/' + expected);
      if (disposed || job !== expected) return;
      if (
        !plainObject(data) ||
        !['running', 'completed', 'failed', 'cancelled'].includes(data.status)
      )
        throw new Error('Malformed bridge job status');
      polls++;
      running = data.status === 'running';
      status(
        `${data.status}: ${safeMessage(data.phase ?? 'working')}${typeof data.error === 'string' ? ' — ' + safeMessage(data.error) : ''}`,
      );
      if (data.status === 'completed') {
        const payload = await request('/jobs/' + expected + '/result');
        if (disposed || job !== expected) return;
        if (!plainObject(payload) || !plainObject(payload.model))
          throw new Error('Malformed bridge model result');
        const model = importBBModel(payload.model);
        const context =
          payload.model.formixel_context === undefined
            ? undefined
            : validateModelContext(model, payload.model.formixel_context);
        result = {
          native: exportBBModelWithContext(model, context),
          model,
          review: payload.review,
          metrics: payload.metrics,
          ...(payload.design !== undefined ? { design: parseDesignDocument(payload.design) } : {}),
          ...(context ? { context } : {}),
        };
        reviewed = false;
        const local = analyzeQuality(model);
        status(
          `Ready for review: ${model.cubes.length} cubes, ${model.textures?.length ?? 0} textures, ${model.animations?.length ?? 0} clips. Local issues: ${local.issues.length}. Choose Review result, then Apply result.`,
        );
      } else if (running) schedule();
    } finally {
      polling = false;
    }
  };
  const generate = async () => {
    if (!connected) throw new Error('Connect the local Formixel bridge first');
    if (running || submitting) throw new Error('A job is already running');
    const form = dialog.getFormResult(),
      prompt = String(form.prompt ?? '').trim(),
      provider = String(form.provider ?? '');
    if (!prompt || byteLength(prompt) > 8192)
      throw new Error('Enter a task description up to 8192 UTF-8 bytes');
    if (!Object.hasOwn(providers, provider)) throw new Error('Choose a supported provider');
    if ((provider === 'openai' || provider === 'anthropic') && !String(form.model ?? '').trim())
      throw new Error('Choose an explicit API model');
    if (references.length && provider !== 'codex')
      throw new Error('Reference images currently require Codex CLI; choose it explicitly');
    const kind = form.kind === 'refine' ? 'refine' : 'craft';
    const anatomy = String(form.anatomy ?? 'prop'),
      hands = String(form.weaponHands ?? 'none'),
      floor = Number(form.floor ?? 0);
    if (
      !['prop', 'biped', 'quadruped'].includes(anatomy) ||
      !['none', '1', '2'].includes(hands) ||
      !Number.isFinite(floor) ||
      Math.abs(floor) > 1_000_000
    )
      throw new Error('Choose a supported anatomy, weapon grip and finite floor height');
    const airborne = String(form.airborneAnimations ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      airborne.length > 128 ||
      airborne.some((id) => !/^[A-Za-z0-9_.:/-]{1,128}$/.test(id)) ||
      new Set(airborne).size !== airborne.length
    )
      throw new Error('Airborne animation IDs must be unique supported identifiers');
    const forwardText = String(form.forward ?? '').trim();
    const forward = forwardText ? forwardText.split(',').map(Number) : undefined;
    if (
      forward &&
      (forward.length !== 3 ||
        forward.some((n) => !Number.isFinite(n)) ||
        forward[1] !== 0 ||
        Math.hypot(...forward) < 1e-9)
    )
      throw new Error(
        'Forward must contain three numbers with zero Y and a nonzero horizontal direction',
      );
    const body: Record<string, unknown> = {
      kind,
      prompt,
      provider,
      brief: {
        anatomy,
        floor,
        ...(forward ? { forward } : {}),
        ...(hands !== 'none' ? { weaponHands: Number(hands) } : {}),
        ...(airborne.length ? { airborneAnimations: airborne } : {}),
      },
      ...(String(form.model ?? '').trim() ? { model: String(form.model).trim() } : {}),
      ...(references.length
        ? { references: references.map(({ role, pngBase64 }) => ({ role, pngBase64 })) }
        : {}),
    };
    if (kind === 'refine') {
      const current = snapshot(),
        selection = String(form.selection ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);
      if (!selection.length)
        throw new Error('Choose parts with Use selected parts before refining');
      prepareRepair(current.model, selection, prompt);
      body.base = current.model;
      body.selection = selection;
      const rig =
        explicitRig ??
        (appliedRig && appliedRig.fingerprint === fingerprint(current.model)
          ? appliedRig
          : undefined);
      if (rig) {
        if (rig.roles) assertAnatomyReferences(current.model, rig.roles);
        if (rig.constraints !== undefined) reviewModel(current.model, rig.constraints);
        if (rig.context) validateModelContext(current.model, rig.context);
        if (rig.roles) body.roles = rig.roles;
        if (rig.constraints !== undefined) body.constraints = rig.constraints;
      } else if (anatomy !== 'prop' || hands !== 'none')
        throw new Error(
          'Load rig roles for this project before refining an articulated character or weapon grip',
        );
    }
    result = undefined;
    reviewed = false;
    status('Submitting the modeling job…');
    submitting = true;
    let response: unknown;
    try {
      response = await request('/jobs', 'POST', body);
    } finally {
      submitting = false;
    }
    if (disposed) return;
    if (
      !plainObject(response) ||
      typeof response.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(response.id)
    )
      throw new Error('Malformed submitted job identifier');
    job = response.id;
    running = true;
    polls = 0;
    status('Running. Local validation follows the provider response.');
    schedule();
  };
  const cancel = async () => {
    if (!job || !running) throw new Error('No running job to cancel');
    stopPolling();
    await request('/jobs/' + job + '/cancel', 'POST');
    status('Cancellation requested…');
    schedule();
  };
  const review = () => {
    if (!result) throw new Error('A validated result is not ready');
    const text = JSON.stringify(
      { local: analyzeQuality(result.model), review: result.review, metrics: result.metrics },
      null,
      2,
    );
    reviewed = true;
    new Dialog({
      id: 'formixel_review',
      title: 'Formixel review',
      width: 680,
      form: {
        review: {
          label: 'Local checks and request usage',
          type: 'textarea',
          readonly: true,
          value: text.length > 32000 ? text.slice(0, 32000) + '\n[Review display truncated]' : text,
          height: 300,
        },
      },
      buttons: ['Close'],
      onClose() {
        if (!disposed) dialog.show();
      },
      onCancel() {
        if (!disposed) dialog.show();
      },
    }).show();
  };
  const apply = () => {
    if (!result || !reviewed) throw new Error('Review a completed result before applying it');
    const model = importBBModel(result.native); // Validate again immediately before editor mutation.
    Codecs.project.load(result.native, { path: 'formixel-result.bbmodel', no_file: true });
    Project.name = model.name;
    appliedRig = undefined;
    const sourceContext =
      result.context ??
      (result.design
        ? createModelContext(model, {
            brief: { anatomy: 'prop' },
            roles: result.design.authoring.roles,
            constraints: result.design.authoring.constraints,
          })
        : undefined);
    if (sourceContext)
      try {
        const actual = snapshot().model;
        const context = rebindModelContext(
          sourceContext,
          model,
          actual,
          editorIDMap(result.native, actual),
        );
        appliedRig = {
          context,
          ...(context.roles ? { roles: context.roles } : {}),
          fingerprint: fingerprint(actual),
          ...(context.constraints ? { constraints: context.constraints } : {}),
        };
        dialog.setFormValues({
          anatomy: context.brief.anatomy,
          floor: context.brief.floor ?? 0,
          weaponHands: String(context.brief.weaponHands ?? 'none'),
          airborneAnimations: context.brief.airborneAnimations?.join(',') ?? '',
          forward: context.brief.forward?.join(',') ?? '',
          rigStatus:
            'Rig context checked against the editor snapshot. Export context to preserve it beside editor saves.',
        });
      } catch (error) {
        dialog.setFormValues({
          rigStatus:
            'Editor changed the model representation; reload matching rig context before refinement.',
        });
        showError(error);
      }
    status('Result opened in a new Blockbench project. The original project is preserved.');
    Blockbench.showQuickMessage('Formixel result opened');
  };
  const loadReference = () => {
    if (references.length >= 8) throw new Error('The reference pack already contains eight images');
    const role = String(dialog.getFormResult().referenceRole ?? 'detail');
    if (!Object.hasOwn(roles, role)) throw new Error('Choose a reference role');
    if (!['detail', 'storyboard'].includes(role) && references.some((r) => r.role === role))
      throw new Error('This orthographic role is already present; clear or choose another role');
    Blockbench.import(
      { type: 'Formixel reference PNG', extensions: ['png'], readtype: 'buffer', multiple: false },
      (files) => {
        if (!files[0] || disposed) return;
        void referencePNG(files[0].content)
          .then((png) => {
            if (disposed) return;
            if (references.length >= 8)
              throw new Error('The reference pack already contains eight images');
            if (!['detail', 'storyboard'].includes(role) && references.some((r) => r.role === role))
              throw new Error('This reference role is already present');
            references.push({
              role,
              pngBase64: base64(png),
              name: String(files[0]!.name ?? 'Reference')
                .replace(/[<>\r\n]/g, '')
                .slice(0, 128),
            });
            dialog.setFormValues({
              references: references
                .map((r, i) => `${i + 1}. ${roles[r.role as keyof typeof roles]} — ${r.name}`)
                .join('\n'),
            });
          })
          .catch(showError);
      },
    );
  };
  const loadRig = () => {
    Blockbench.import(
      {
        type: 'Formixel rig roles or design',
        extensions: ['json'],
        readtype: 'text',
        multiple: false,
      },
      (files) => {
        if (!files[0] || disposed) return;
        try {
          if (typeof files[0].content !== 'string' || byteLength(files[0].content) > 2_000_000)
            throw new Error('Choose a bounded JSON rig or design file');
          const value: unknown = JSON.parse(files[0].content);
          const current = snapshot().model;
          let rig: RigSidecar;
          if (plainObject(value) && value.version === 1 && value.modelDigest !== undefined) {
            const context = validateModelContext(current, value);
            rig = {
              context,
              ...(context.roles ? { roles: context.roles } : {}),
              ...(context.constraints ? { constraints: context.constraints } : {}),
            };
            dialog.setFormValues({
              anatomy: context.brief.anatomy,
              floor: context.brief.floor ?? 0,
              weaponHands: String(context.brief.weaponHands ?? 'none'),
              airborneAnimations: context.brief.airborneAnimations?.join(',') ?? '',
            });
            dialog.setFormValues({ forward: context.brief.forward?.join(',') ?? '' });
          } else if (plainObject(value) && value.version === 1 && value.authoring !== undefined) {
            const design = parseDesignDocument(value);
            if (!design.authoring.roles) throw new Error('This design contains no anatomy roles');
            rig = {
              roles: parseAnatomyRoles(design.authoring.roles),
              ...(design.authoring.constraints
                ? { constraints: design.authoring.constraints }
                : {}),
            };
          } else if (plainObject(value) && value.roles !== undefined) {
            if (Object.keys(value).some((k) => !['roles', 'constraints'].includes(k)))
              throw new Error('Unknown rig sidecar field');
            rig = {
              roles: parseAnatomyRoles(value.roles),
              ...(value.constraints !== undefined ? { constraints: value.constraints } : {}),
            };
          } else rig = { roles: parseAnatomyRoles(value) };
          if (rig.roles) assertAnatomyReferences(current, rig.roles);
          if (rig.constraints !== undefined) reviewModel(current, rig.constraints);
          explicitRig = rig;
          dialog.setFormValues({
            rigStatus: 'Rig roles loaded and references checked against the current project.',
          });
        } catch (e) {
          showError(e);
        }
      },
    );
  };
  dialog = new Dialog({
    id: 'formixel_workspace',
    title: 'Formixel modeling workspace',
    width: 760,
    cancelIndex: 5,
    form: {
      endpoint: {
        label: 'Local bridge address',
        type: 'text',
        placeholder: 'http://127.0.0.1:port',
      },
      token: {
        label: 'Pairing token',
        type: 'password',
        description: 'Paste the token printed by formixel bridge. It stays in this window only.',
      },
      connection: {
        type: 'buttons',
        buttons: ['Connect', 'Disconnect'],
        click: (index: number) => {
          if (index === 0) void connect().catch(showError);
          else {
            if (running || submitting) {
              showError(new Error('Cancel the current job before disconnecting'));
              return;
            }
            stopPolling();
            connectionVersion++;
            for (const controller of controllers) controller.abort();
            connected = false;
            token = '';
            endpoint = '';
            result = undefined;
            reviewed = false;
            job = undefined;
            dialog.setFormValues({ token: '' });
            status('Disconnected');
          }
        },
      },
      kind: {
        label: 'Action',
        type: 'select',
        options: { craft: 'Create a new model', refine: 'Refine selected parts' },
        value: 'craft',
      },
      anatomy: {
        label: 'Anatomy',
        type: 'select',
        options: {
          prop: 'Object / prop',
          biped: 'Two-legged character',
          quadruped: 'Four-legged creature',
        },
        value: 'prop',
      },
      weaponHands: {
        label: 'Held weapon',
        type: 'select',
        options: { none: 'None', 1: 'One hand', 2: 'Two hands' },
        value: 'none',
      },
      floor: { label: 'Ground height', type: 'number', value: 0 },
      forward: { label: 'Forward direction (optional)', type: 'text', placeholder: '0,0,-1' },
      airborneAnimations: {
        label: 'Airborne clips (optional IDs)',
        type: 'text',
        description: 'Explicit clip IDs allowed to leave the ground, separated by commas.',
      },
      prompt: {
        label: 'What should change?',
        type: 'textarea',
        value: initial.prompt ?? '',
        height: 70,
      },
      provider: {
        label: 'Planner',
        type: 'select',
        options: providers,
        value: initial.provider ?? 'codex',
      },
      model: { label: 'Model (required for API)', type: 'text', value: initial.model ?? '' },
      selection: {
        label: 'Parts to refine',
        type: 'text',
        placeholder: 'Use selected parts, or enter node:part IDs',
      },
      useSelection: {
        type: 'buttons',
        buttons: ['Use selected parts'],
        click: () => {
          try {
            const current = snapshot();
            dialog.setFormValues({
              kind: 'refine',
              selection: selectedIDs(current.native, current.model).join(','),
            });
          } catch (e) {
            showError(e);
          }
        },
      },
      rigActions: {
        type: 'buttons',
        buttons: ['Load rig context / roles', 'Clear rig roles', 'Export context'],
        click: (index: number) => {
          try {
            if (index === 0) loadRig();
            else if (index === 1) {
              explicitRig = undefined;
              appliedRig = undefined;
              dialog.setFormValues({ rigStatus: 'No rig roles loaded.' });
            } else {
              const current = snapshot().model;
              const rig =
                explicitRig ??
                (appliedRig?.fingerprint === fingerprint(current) ? appliedRig : undefined);
              if (!rig?.context)
                throw new Error(
                  'Apply a result with matching model context, or load its context file first',
                );
              const context = validateModelContext(current, rig.context);
              Blockbench.export({
                type: 'Formixel model context',
                extensions: ['json'],
                name: 'model.context',
                content: JSON.stringify(context, null, 2),
              });
            }
          } catch (e) {
            showError(e);
          }
        },
      },
      rigStatus: {
        label: 'Rig checks',
        type: 'text',
        readonly: true,
        value:
          'Applied design roles are reused only while the project snapshot matches. Imported projects can load a rig sidecar.',
      },
      referenceRole: { label: 'Next reference', type: 'select', options: roles, value: 'detail' },
      referenceActions: {
        type: 'buttons',
        buttons: ['Add PNG reference', 'Clear references'],
        click: (index: number) => {
          try {
            if (index === 0) loadReference();
            else {
              references.length = 0;
              dialog.setFormValues({ references: '' });
            }
          } catch (e) {
            showError(e);
          }
        },
      },
      references: {
        label: 'Reference pack',
        type: 'textarea',
        readonly: true,
        value: '',
        height: 55,
      },
      status: {
        label: 'Progress',
        type: 'textarea',
        readonly: true,
        value: 'Start formixel bridge locally, then paste its address and pairing token.',
        height: 55,
      },
    },
    buttons: ['Generate', 'Refresh status', 'Cancel job', 'Review result', 'Apply result', 'Close'],
    onButton(index: number) {
      if (index === 5) {
        if (running || submitting) {
          showError(new Error('Cancel the current job before closing this workspace'));
          return false;
        }
        dispose();
        return;
      }
      try {
        if (index === 0) void generate().catch(showError);
        if (index === 1) {
          polls = 0;
          void poll().catch(showError);
        }
        if (index === 2) void cancel().catch(showError);
        if (index === 3) review();
        if (index === 4) apply();
      } catch (e) {
        showError(e);
      }
      return false;
    },
    onCancel() {
      if (running || submitting) {
        showError(new Error('Cancel the current job before closing this workspace'));
        return false;
      }
      dispose();
    },
    onClose() {
      if (running || submitting) {
        showError(new Error('Cancel the current job before closing this workspace'));
        return false;
      }
      dispose();
    },
  });
  workspaces.add(dispose);
  activeWorkspace = dialog;
  dialog.show();
}

Plugin.register('formixel', {
  title: 'Formixel',
  author: 'Formixel contributors',
  description:
    'Compile locally and create or refine textured models through the paired Formixel CLI bridge.',
  icon: 'view_in_ar',
  version: '1.5.0',
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
            source: { label: 'FXL or design source', type: 'textarea', value: example },
            prompt: { label: 'Task description', type: 'text' },
            provider: { label: 'Planner', type: 'select', options: providers, value: 'codex' },
            model: { label: 'Model (required for API)', type: 'text' },
          },
          buttons: ['Build FXL', 'Load FXL', 'Export task', 'Close', 'Modeling workspace'],
          cancelIndex: 3,
          onButton(index: number) {
            const form = dialog.getFormResult();
            try {
              if (index === 0) buildInBlockbench(form.source);
              if (index === 1) {
                Blockbench.import(
                  {
                    type: 'Formixel source',
                    extensions: ['fxl', 'bbscript', 'json'],
                    readtype: 'text',
                  },
                  (files) => {
                    if (files[0] && typeof files[0].content === 'string')
                      dialog.setFormValues({ source: files[0].content });
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
              if (index === 4) {
                openWorkspace(form);
                return false;
              }
            } catch (e) {
              showError(e);
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
    for (const dispose of [...workspaces]) dispose();
    action?.delete();
    action = undefined;
  },
});

/**
 * 카탈로그 밖 모델 불러오기 (계산기 P2, PROGRESS §4 D57) — 브라우저가 Hugging Face 공개 API 에 직접 요청한다(CanRun 서버 없음).
 * 계산기 아일랜드가 사용자가 "불러오기"를 눌렀을 때만 dynamic import 한다 — 첫 화면 번들에 들어가지 않는다.
 *
 * 순서: 입력 해석 → 모델 정보(GGUF 저장소면 base_model 로 원본을 찾는다) → 원본 config.json → GGUF 저장소 트리(파일 크기)
 *   → MoE 면 기준 양자화(Q4_K_M, 없으면 MXFP4 — 10-22 D115) 파일의 GGUF 헤더를 Range 로 읽어 전문가·비전문가 크기 → `buildHfModel` 로 엔진 입력 레코드.
 * 구조 분류·파일 매칭·헤더 해석은 데이터 동기화 스크립트와 같은 코드(`@canrun/data/hf`)다.
 */
import type { ModelCore, ModelQuantCore } from '@canrun/data/client';
import {
  buildHfModel,
  classifyArch,
  KNOWN_MODEL_TYPES,
  measureSplit,
  parseHfInput,
  quantRowsFrom,
  rankGgufRepos,
  type TreeEntry,
} from '@canrun/data/hf';

const HF = 'https://huggingface.co';

export type HfErrorCode =
  | 'invalid'
  | 'not-found'
  | 'gated'
  | 'unsupported'
  /** GGUF 저장소인데 원본(base_model)을 적지 않았다 */
  | 'no-base'
  | 'no-gguf'
  /** GGUF 저장소를 넣었는데 기준 양자화(Q4_K_M, 없으면 MXFP4) 파일이 없다 */
  | 'no-base-quant'
  | 'no-params'
  | 'network';

const MB = 1024 * 1024;
/**
 * 브라우저의 GGUF 헤더 읽기 상한 (10-01 리뷰) — 공유 링크(hf=)는 열기만 해도 불러오므로, 임의 저장소가 조각 수·헤더 크기로
 * 대량 다운로드를 일으키지 못하게 한다. 넘으면 헤더 실측 없이 균등 bpw 유도로 계산한다.
 */
const BROWSER_HEADER_LIMITS = { maxShards: 16, maxBytes: 16 * MB, totalMaxBytes: 24 * MB } as const;

export type HfLoadResult =
  | {
      kind: 'ok';
      /** 사용자가 고른 저장소 id (URL `hf=` 값) */
      hfId: string;
      /** 원본 모델 id (GGUF 저장소를 넣었으면 base_model) */
      baseId: string;
      ggufRepo: string;
      model: ModelCore;
      rows: ModelQuantCore[];
      notes: string[];
    }
  /** 이미 카탈로그에 있는 모델 — 불러오지 않고 그 카드로 안내한다 */
  | { kind: 'catalog'; hfId: string; modelId: string }
  | { kind: 'error'; code: HfErrorCode; hfId?: string; modelType?: string };

type Fetch = typeof fetch;

type HfModelInfo = {
  id?: string;
  gated?: boolean | string;
  siblings?: { rfilename: string }[];
  cardData?: { license?: string; license_name?: string; base_model?: string | string[] };
  safetensors?: { total?: number };
};

class HfHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function getJson<T>(f: Fetch, url: string): Promise<T> {
  const res = await f(url);
  if (!res.ok) throw new HfHttpError(res.status);
  return (await res.json()) as T;
}

/** HF 트리 API — `Link: <…>; rel="next"` 페이지를 끝까지 (큰 저장소는 1000개 단위) */
async function getTree(f: Fetch, repo: string): Promise<TreeEntry[]> {
  const out: TreeEntry[] = [];
  let url: string | undefined = `${HF}/api/models/${repo}/tree/main?recursive=true`;
  for (let page = 0; url && page < 20; page += 1) {
    const res: Response = await f(url);
    if (!res.ok) throw new HfHttpError(res.status);
    out.push(...((await res.json()) as TreeEntry[]));
    const link: string | null = res.headers.get('link');
    url = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  }
  return out;
}

const firstBase = (info: HfModelInfo): string | undefined => {
  const b = info.cardData?.base_model;
  const id = Array.isArray(b) ? b[0] : b;
  return typeof id === 'string' && /^[^/\s]+\/[^/\s]+$/.test(id) ? id : undefined;
};

const isGgufRepo = (info: HfModelInfo): boolean => (info.siblings ?? []).some((s) => s.rfilename.toLowerCase().endsWith('.gguf'));

/** 원본 config — 게이트 모델(401·403)은 unsloth 미러 config 로 (add-model 과 같은 대체, 같은 구조 값) */
async function getConfig(f: Fetch, baseId: string): Promise<{ config: unknown } | { gated: true }> {
  try {
    return { config: await getJson<unknown>(f, `${HF}/${baseId}/resolve/main/config.json`) };
  } catch (err) {
    if (!(err instanceof HfHttpError) || (err.status !== 401 && err.status !== 403)) throw err;
    const mirror = `unsloth/${baseId.split('/')[1]}`;
    try {
      return { config: await getJson<unknown>(f, `${HF}/${mirror}/resolve/main/config.json`) };
    } catch {
      return { gated: true };
    }
  }
}

/**
 * 원본 모델 → 같은 모델의 GGUF 저장소(공식 → ggml-org → bartowski → unsloth → lmstudio-community 중 기준 양자화(Q4_K_M, 없으면 MXFP4)가 있는 첫 곳).
 * 검색은 다운로드순 — 인기 모델은 같은 이름의 파생(파인튠·abliterated) GGUF 가 수백 개라 기본 정렬이면 원 변환본이 밀린다.
 * 관례 이름(`<owner>/<name>-GGUF`·`bartowski/<owner>_<name>-GGUF` 등)도 후보에 넣는다 (10-01 실측 — Llama 3.1 8B Instruct)
 */
async function findGgufRepo(f: Fetch, baseId: string): Promise<{ repo: string; tree: TreeEntry[] } | undefined> {
  const [owner = '', name = baseId] = baseId.split('/');
  const hits = await getJson<{ id: string }[]>(
    f,
    `${HF}/api/models?search=${encodeURIComponent(name)}&filter=gguf&sort=downloads&direction=-1&limit=100`,
  ).catch(() => [] as { id: string }[]);
  const conventional = [
    `${owner}/${name}-GGUF`,
    `ggml-org/${name}-GGUF`,
    `bartowski/${owner}_${name}-GGUF`,
    `bartowski/${name}-GGUF`,
    `unsloth/${name}-GGUF`,
    `lmstudio-community/${name}-GGUF`,
  ];
  const candidates = [...new Set([...hits.map((h) => h.id), ...conventional])];
  for (const repo of rankGgufRepos(candidates, baseId).slice(0, 6)) {
    const tree = await getTree(f, repo).catch(() => undefined);
    if (tree && quantRowsFrom(tree, repo, 'probe').length > 0) return { repo, tree };
  }
  return undefined;
}

export type HfLoadOptions = {
  /** HF id → 카탈로그 모델 id (대소문자 무시). 있으면 불러오지 않고 'catalog' 로 돌려준다 */
  catalogIdFor?: (hfId: string) => string | undefined;
};

export async function loadHfModel(
  text: string,
  f: Fetch = (...a) => fetch(...a),
  opts: HfLoadOptions = {},
): Promise<HfLoadResult> {
  const hfId = parseHfInput(text);
  if (!hfId) return { kind: 'error', code: 'invalid' };
  // 원본 저장소를 넣었으면 요청 없이 바로 카탈로그 확인
  const direct = opts.catalogIdFor?.(hfId);
  if (direct) return { kind: 'catalog', hfId, modelId: direct };
  try {
    let info: HfModelInfo;
    try {
      info = await getJson<HfModelInfo>(f, `${HF}/api/models/${hfId}`);
    } catch (err) {
      if (err instanceof HfHttpError && (err.status === 404 || err.status === 401)) return { kind: 'error', code: 'not-found', hfId };
      throw err;
    }

    // GGUF 저장소를 넣었으면 원본은 base_model, 원본을 넣었으면 GGUF 저장소를 찾는다.
    // 구조 판정(config)을 먼저 — 계산할 수 없는 구조면 GGUF 저장소 검색까지 갈 필요가 없고 안내도 정확하다
    const gguf = isGgufRepo(info);
    const baseId = gguf ? firstBase(info) : hfId;
    if (!baseId) return { kind: 'error', code: 'no-base', hfId };
    const inCatalog = opts.catalogIdFor?.(baseId);
    if (inCatalog) return { kind: 'catalog', hfId, modelId: inCatalog };
    const baseInfo: HfModelInfo = gguf ? await getJson<HfModelInfo>(f, `${HF}/api/models/${baseId}`).catch(() => ({})) : info;
    // 이름이 바뀐 저장소: HF 는 옛 이름을 새 이름으로 돌려준다 — 그 정식 id 로 한 번 더 카탈로그 대조
    const canonical = baseInfo.id && baseInfo.id.toLowerCase() !== baseId.toLowerCase() ? opts.catalogIdFor?.(baseInfo.id) : undefined;
    if (canonical) return { kind: 'catalog', hfId, modelId: canonical };

    const cfg = await getConfig(f, baseId);
    if ('gated' in cfg) return { kind: 'error', code: 'gated', hfId };
    const arch = classifyArch(cfg.config);
    if (arch.kind !== 'ok') {
      // model_type 은 그것이 거절 사유일 때만 보인다(알려진 종류인데 다른 이유로 거절되면 일반 안내)
      const mt = modelTypeOf(cfg.config);
      return { kind: 'error', code: 'unsupported', hfId, ...(mt.modelType && !KNOWN_MODEL_TYPES.has(mt.modelType) ? mt : {}) };
    }

    let ggufRepo: string;
    let tree: TreeEntry[];
    if (gguf) {
      ggufRepo = hfId;
      tree = await getTree(f, hfId);
    } else {
      const found = await findGgufRepo(f, hfId);
      if (!found) return { kind: 'error', code: 'no-gguf', hfId };
      ggufRepo = found.repo;
      tree = found.tree;
    }

    // MoE 는 기준 양자화 파일 헤더로 전문가·비전문가 크기를 잰다 (수 MB Range 읽기) — 실패하면 균등 bpw 유도로 대체
    let baseSplit: Parameters<typeof buildHfModel>[0]['baseSplit'];
    const paramsB = baseInfo.safetensors?.total ? baseInfo.safetensors.total / 1e9 : undefined;
    const base = quantRowsFrom(tree, ggufRepo, 'probe')[0];
    if (base?.fileName && (arch.moe || paramsB === undefined)) {
      try {
        const m = await measureSplit(ggufRepo, base.fileName, { fetch: f, ...BROWSER_HEADER_LIMITS });
        baseSplit = {
          expertGB: m.expertGB,
          nonExpertGB: m.nonExpertGB,
          ...(m.totalParams !== undefined ? { totalParamsB: m.totalParams / 1e9 } : {}),
          ...(m.expertParams !== undefined ? { expertParamsB: m.expertParams / 1e9 } : {}),
        };
      } catch {
        baseSplit = undefined;
      }
    }

    const built = buildHfModel({
      hfId: baseId,
      ggufRepo,
      config: cfg.config,
      tree,
      info: {
        ...(baseInfo.cardData?.license ? { license: baseInfo.cardData.license } : {}),
        ...(typeof baseInfo.cardData?.license_name === 'string' ? { licenseName: baseInfo.cardData.license_name } : {}),
        ...(paramsB !== undefined ? { paramsB } : {}),
      },
      ...(baseSplit ? { baseSplit } : {}),
    });
    if (built.kind !== 'ok') {
      return { kind: 'error', code: built.kind === 'no-gguf' && gguf ? 'no-base-quant' : built.kind, hfId };
    }
    return { kind: 'ok', hfId, baseId, ggufRepo, model: built.model, rows: built.rows, notes: built.notes };
  } catch {
    return { kind: 'error', code: 'network', hfId };
  }
}

/** 지원하지 않는 구조 안내에 쓸 model_type (멀티모달은 text_config 우선) */
function modelTypeOf(config: unknown): { modelType?: string } {
  if (typeof config !== 'object' || config === null) return {};
  const top = config as Record<string, unknown>;
  const text = top['text_config'];
  const t = (typeof text === 'object' && text !== null ? (text as Record<string, unknown>)['model_type'] : undefined) ?? top['model_type'];
  return typeof t === 'string' && /^[\w.-]{1,64}$/.test(t) ? { modelType: t } : {};
}

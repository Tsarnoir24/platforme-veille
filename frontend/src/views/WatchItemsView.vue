<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';

import {
  useRoute,
  useRouter,
} from 'vue-router';

import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';

import {
  useToast,
} from 'primevue/usetoast';

import PlusIcon from '@primeicons/vue/plus';
import ArrowRightIcon from '@primeicons/vue/arrow-right';
import BookmarkIcon from '@primeicons/vue/bookmark';
import CheckCircleIcon from '@primeicons/vue/check-circle';
import ExternalLinkIcon from '@primeicons/vue/external-link';
import StarIcon from '@primeicons/vue/star';
import StarFillIcon from '@primeicons/vue/star-fill';
import TrashIcon from '@primeicons/vue/trash';

import AppLayout from '../layouts/AppLayout.vue';
import PageHeader from '../components/ui/PageHeader.vue';
import SectionCard from '../components/ui/SectionCard.vue';
import SourceTypeBadge from '../components/ui/SourceTypeBadge.vue';
import StatusBadge from '../components/ui/StatusBadge.vue';
import { safeExternalUrl } from '../utils/safe-external-url';
import { renderSafeInlineHtml, stripHtmlTags } from '../utils/clean-text';

import {
  errorFr,
} from '../i18n/errors';

import {
  labelFr,
  optionsFr,
  registerCategoryLabels,
} from '../i18n/labels';

import {
  useAuthStore,
} from '../stores/auth';

import {
  searchWatchItems,
  type SearchParams,
} from '../services/search.service';

import {
  addFavorite,
  getFavorites,
  removeFavorite,
} from '../services/favorites.service';

import {
  createSavedView,
  deleteSavedView,
  getSavedViews,
} from '../services/saved-views.service';

import type {
  WatchItem,
} from '../services/watch-items.service';
import { translateMissingWatchItems } from '../services/watch-items.service';

import {
  createSource,
  discoverSourceUrl,
  importManualSource,
  type DiscoveredSourceResult,
} from '../services/sources.service';

import {
  defaultSourceQuery,
  registerCategoryQueries,
} from '../utils/source-targeting';
import {
  getCategories,
  type WatchCategory,
} from '../services/taxonomy.service';


const router =
  useRouter();

const route =
  useRoute();

const auth =
  useAuthStore();

const toast =
  useToast();

const mobileFiltersExpanded = ref(false);

function quickFilter(type: 'all' | 'critical' | 'high' | 'to_qualify' | 'favorites') {
  if (type === 'all') {
    filters.value.criticality = '';
    filters.value.status = '';
    filters.value.favoritesOnly = false;
  } else if (type === 'critical') {
    filters.value.criticality = filters.value.criticality === 'CRITIQUE' ? '' : 'CRITIQUE';
  } else if (type === 'high') {
    filters.value.criticality = filters.value.criticality === 'ELEVEE' ? '' : 'ELEVEE';
  } else if (type === 'to_qualify') {
    filters.value.status = filters.value.status === 'A_QUALIFIER' ? '' : 'A_QUALIFIER';
  } else if (type === 'favorites') {
    filters.value.favoritesOnly = !filters.value.favoritesOnly;
  }
  filters.value.page = 1;
  search();
}

function queryValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

type AiQualificationFilter = '' | 'GENERATED' | 'NOT_GENERATED';

function queryAiQualification(value: unknown): AiQualificationFilter {
  return value === 'GENERATED' || value === 'NOT_GENERATED' ? value : '';
}

function titleHtml(title: string): string {
  return renderSafeInlineHtml(title);
}

function queryNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(queryValue(value));
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function querySortOrder(value: unknown): 'ASC' | 'DESC' {
  return queryValue(value, 'DESC') === 'ASC' ? 'ASC' : 'DESC';
}

const sortableFields = new Set([
  'publishedAt',
  'collectedAt',
  'relevance',
  'criticality',
  'title',
  'sourceName',
  'sourceType',
  'summary',
  'status',
]);

function querySortBy(value: unknown): string {
  const field = queryValue(value, 'collectedAt');
  return sortableFields.has(field) ? field : 'collectedAt';
}

const initialListQuery = route.query;


const sourceDialogVisible =
  ref(false);

const sourceSubmitting =
  ref(false);

const sourceError =
  ref('');

const sourceCreationMode = ref<'DIRECT' | 'WEB_PAGE'>('DIRECT');
const webPageUrl = ref('');
const analyzingWebUrl = ref(false);
const discoveredInfo = ref<DiscoveredSourceResult | null>(null);

function resetNewSourceDialogState() {
  sourceError.value = '';
  sourceCreationMode.value = 'DIRECT';
  webPageUrl.value = '';
  discoveredInfo.value = null;
  manualImportFile.value = null;
  if (manualImportInput.value) manualImportInput.value.value = '';
  targetQuery.value = '';
  sourceForm.value = {
    name: '',
    organization: '',
    country: '',
    category: '',
    sourceType: '',
    baseUrl: '',
    frequency: '',
    active: true,
  };
}

async function refreshCategories() {
  try {
    const { data } = await getCategories();
    if (Array.isArray(data)) {
      dbCategories.value = data;
      registerCategoryLabels(data);
      registerCategoryQueries(data);
    }
  } catch {
    // Conserve les catégories déjà chargées en cas d'erreur réseau.
  }
}

function openNewSourceDialog() {
  resetNewSourceDialogState();
  void refreshCategories();
  sourceDialogVisible.value = true;
}

function switchSourceCreationMode(mode: 'DIRECT' | 'WEB_PAGE') {
  sourceCreationMode.value = mode;
  sourceError.value = '';
  webPageUrl.value = '';
  discoveredInfo.value = null;
  manualImportFile.value = null;
  if (manualImportInput.value) manualImportInput.value.value = '';
  targetQuery.value = '';
  sourceForm.value = {
    name: '',
    organization: '',
    country: '',
    category: '',
    sourceType: '',
    baseUrl: '',
    frequency: '',
    active: true,
  };
}

async function analyzeWebPageUrl() {
  const raw = webPageUrl.value.trim();
  if (!raw || analyzingWebUrl.value) return;
  analyzingWebUrl.value = true;
  sourceError.value = '';
  try {
    const { data } = await discoverSourceUrl(raw);
    discoveredInfo.value = data;
    sourceForm.value.baseUrl = data.resolvedUrl;
    sourceForm.value.sourceType = data.detectedType;
    if (data.suggestedTitle && !sourceForm.value.name.trim()) {
      sourceForm.value.name = data.suggestedTitle;
    }
    if (data.suggestedOrganization && !sourceForm.value.organization.trim()) {
      sourceForm.value.organization = data.suggestedOrganization;
    }
    if (data.suggestedCountry && !sourceForm.value.country.trim()) {
      sourceForm.value.country = data.suggestedCountry;
    }
    if (data.suggestedCategory && !sourceForm.value.category) {
      sourceForm.value.category = data.suggestedCategory;
    }
    if (data.suggestedFrequency && !sourceForm.value.frequency.trim()) {
      sourceForm.value.frequency = data.suggestedFrequency;
    }
  } catch (cause) {
    sourceError.value = errorMessage(cause, "Impossible d'analyser ce lien web.");
  } finally {
    analyzingWebUrl.value = false;
  }
}

const manualImportFile =
  ref<File | null>(null);

const manualImportInput =
  ref<HTMLInputElement | null>(null);

const targetQuery =
  ref('');

const CROSSREF_API_URL =
  'https://api.crossref.org';


const dbCategories = ref<WatchCategory[]>([]);

const defaultSourceCategoryOptions = [
  'SCIENTIFIQUE',
  'REGLEMENTAIRE',
  'ACCREDITATION',
  'NORMATIF',
  'ENVIRONNEMENT',
  'AUTRE',
];

const sourceCategoryDropdownItems = computed(() => {
  if (!dbCategories.value.length) return optionsFr(defaultSourceCategoryOptions);
  return dbCategories.value
    .filter((c) => c.active)
    .map((c) => ({
      label: c.name || labelFr(c.code),
      value: c.code,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }));
});


const sourceCreationTypeOptions = [
  'API',
  'RSS',
  'ATOM',
  'IMPORT_MANUEL',
];


const sourceForm =
  ref({
    name:
      '',

    organization:
      '',

    country:
      '',

    category:
      '',

    sourceType:
      '',

    baseUrl:
      '',

    frequency:
      '',

    active:
      true,
  });

function applyManualSourceDefaults(sourceType: unknown) {
  const value = typeof sourceType === 'string'
    ? sourceType
    : (sourceType as { value?: string } | null)?.value;
  if (value !== 'IMPORT_MANUEL') return;
  sourceForm.value.baseUrl = '';
  sourceForm.value.frequency = '';
  if (!sourceForm.value.name.trim()) sourceForm.value.name = 'Import manuel';
  if (!sourceForm.value.category) sourceForm.value.category = 'AUTRE';
}

function selectManualImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = input.files?.[0] ?? null;
  sourceError.value = '';
  if (selected && selected.size > 5 * 1024 * 1024) {
    manualImportFile.value = null;
    input.value = '';
    sourceError.value = 'Le fichier dépasse la taille maximale de 5 Mo.';
    return;
  }
  manualImportFile.value = selected;
}


watch(
  () =>
    sourceForm.value.category,

  (category) => {
    targetQuery.value =
      defaultSourceQuery(
        category,
      );
  },
);


watch(
  () =>
    sourceForm.value.sourceType,

  (
    sourceType,
    previousType,
  ) => {
    if (sourceType !== 'IMPORT_MANUEL') {
      manualImportFile.value = null;
      if (manualImportInput.value) manualImportInput.value.value = '';
    }
    if (
      sourceType ===
      'API'
    ) {
      sourceForm.value.baseUrl =
        CROSSREF_API_URL;
    } else if (
      sourceType ===
      'IMPORT_MANUEL'
    ) {
      applyManualSourceDefaults(sourceType);

      targetQuery.value =
        '';
      webPageUrl.value = '';
      discoveredInfo.value = null;
      sourceCreationMode.value = 'DIRECT';
    } else if (
      previousType ===
      'API'
      &&
      sourceForm.value.baseUrl ===
      CROSSREF_API_URL
    ) {
      sourceForm.value.baseUrl =
        '';
    }
  },
);


interface SavedView {
  id:
  number;

  name:
  string;

  filters:
  Partial<SearchParams>;
}


interface WatchItemSearchResponse {
  items:
  WatchItem[];

  total:
  number;

  page:
  number;

  limit:
  number;

  pages:
  number;
}


const sourceRoles =
  computed(
    () =>
      auth.user?.roles
      ??
      [],
  );


const canCreateSource =
  computed(
    () =>
      sourceRoles.value.includes(
        'ADMIN',
      )
      ||
      sourceRoles.value.includes(
        'OPERATEUR_VEILLE',
      ),
  );

const canTranslateExisting = computed(() =>
  ['ADMIN', 'RESPONSABLE_VEILLE', 'OPERATEUR_VEILLE']
    .some((role) => sourceRoles.value.includes(role)),
);
const translatingExisting = ref(false);

async function translateExistingBatch() {
  if (translatingExisting.value) return;
  translatingExisting.value = true;
  try {
    let translated = 0;
    let failed = 0;
    let remaining = 0;
    let processedAnyBatch = false;

    // Chaque requête traite un lot limité. On enchaîne les lots ici pour que
    // l’utilisateur puisse lancer la reprise une seule fois depuis cette page.
    do {
      const result = (await translateMissingWatchItems()).data;
      processedAnyBatch = true;
      translated += result.translated;
      failed += result.failed;
      remaining = result.remaining;

      // S’il n’y a aucun succès, les éléments restants sont probablement en
      // échec (quota ou clés DeepL) : arrêter évite une boucle sans progrès.
      if (result.translated === 0) break;
    } while (remaining > 0);

    if (translated > 0 && remaining === 0) {
      toast.add({
        severity: 'success',
        summary: 'Traductions enregistrées',
        detail: `${translated} veille(s) traduite(s). Toutes les veilles en attente ont été traitées.`,
        life: 7000,
      });
      await load();
    } else if (translated > 0) {
      toast.add({
        severity: 'warn',
        summary: 'Traduction partielle',
        detail: `${translated} veille(s) traduite(s), ${remaining} restent à traiter. ${failed} échec(s) ; vérifiez les clés ou le quota DeepL puis relancez l’action ici.`,
        life: 9000,
      });
      await load();
    } else if (remaining > 0) {
      toast.add({
        severity: 'warn',
        summary: 'Traduction indisponible',
        detail: `${failed} veille(s) n’ont pas pu être traduites. Vérifiez les clés et le quota DeepL, puis relancez l’action ici.`,
        life: 8000,
      });
    } else if (processedAnyBatch) {
      toast.add({
        severity: 'info',
        summary: 'Aucune traduction à reprendre',
        detail: 'Toutes les veilles disposent déjà d’une version française.',
        life: 5000,
      });
    }
  } catch (cause) {
    toast.add({
      severity: 'error',
      summary: 'Traduction impossible',
      detail: errorMessage(cause, 'Impossible de traduire les veilles existantes.'),
      life: 7000,
    });
  } finally {
    translatingExisting.value = false;
  }
}


async function submitSource() {
  if (
    !canCreateSource.value
    ||
    sourceSubmitting.value
  ) {
    return;
  }

  if (sourceCreationMode.value === 'WEB_PAGE') {
    if (!sourceForm.value.baseUrl.trim() && webPageUrl.value.trim()) {
      sourceForm.value.baseUrl = webPageUrl.value.trim();
    }
    if (!sourceForm.value.sourceType || sourceForm.value.sourceType === 'IMPORT_MANUEL') {
      sourceForm.value.sourceType = 'RSS';
    }
  }

  if (sourceForm.value.sourceType === 'IMPORT_MANUEL' && !manualImportFile.value) {
    sourceError.value = 'Sélectionnez un fichier CSV, XLSX ou PDF pour lancer l’import immédiatement.';
    return;
  }

  sourceSubmitting.value =
    true;

  sourceError.value =
    '';

  let sourceCreated = false;
  try {
    const response =
      await createSource({
        ...sourceForm.value,

        baseUrl:
          sourceForm.value.baseUrl
            .trim()
          ||
          undefined,
        query: sourceForm.value.sourceType === 'IMPORT_MANUEL'
          ? undefined
          : targetQuery.value,
      });
    sourceCreated = true;

    const importResult = sourceForm.value.sourceType === 'IMPORT_MANUEL' && manualImportFile.value
      ? (await importManualSource(response.data.id, manualImportFile.value)).data
      : null;


    sourceDialogVisible.value =
      false;

    manualImportFile.value = null;
    if (manualImportInput.value) manualImportInput.value.value = '';


    sourceForm.value = {
      name:
        '',

      organization:
        '',

      country:
        '',

      category:
        '',

      sourceType:
        '',

      baseUrl:
        '',

      frequency:
        '',

      active:
        true,
    };


    targetQuery.value =
      '';

    await load();

    if (importResult) {
      toast.add({
        severity: importResult.errors ? 'warn' : 'success',
        summary: importResult.errors ? 'Source créée, import avec erreurs' : 'Source créée et importée',
        detail: `${importResult.received} reçu(s) · ${importResult.created} créé(s) · ${importResult.updated} mis à jour · ${importResult.duplicates} doublon(s) · ${importResult.errors} erreur(s)`,
        life: 12000,
      });
    } else if (response.data.initialCollection?.status === 'FAILED') {
      toast.add({
        severity: 'warn',
        summary: 'Source créée, collecte échouée',
        detail: response.data.initialCollection.message ?? 'La première collecte n’a pas abouti. Vous pourrez la relancer depuis la liste des sources.',
        life: 10000,
      });
    } else if (response.data.initialCollection?.status === 'COMPLETED_WITH_ERRORS') {
      const result = response.data.initialCollection;
      toast.add({
        severity: 'warn',
        summary: 'Source créée, collecte avec erreurs',
        detail: `${result.received ?? 0} reçu(s) · ${result.created ?? 0} créé(s) · ${result.updated ?? 0} mis à jour · ${result.duplicates ?? 0} doublon(s) · ${result.errors ?? 0} erreur(s)`,
        life: 12000,
      });
    } else {
      const result = response.data.initialCollection;
      const skipped = result?.status === 'SKIPPED';
      toast.add({
        severity: result?.status === 'IN_PROGRESS' || skipped ? 'info' : 'success',
        summary: result?.status === 'IN_PROGRESS'
          ? 'Collecte en cours'
          : skipped
            ? 'Source inactive'
            : 'Source créée et collectée',
        detail: result?.status === 'COMPLETED'
          ? `${result.received ?? 0} reçu(s) · ${result.created ?? 0} nouvel(le)(s) · ${result.duplicates ?? 0} doublon(s).`
          : result?.message ?? 'La source a été enregistrée.',
        life: 8000,
      });
    }
  } catch (
  cause
  ) {
    const message = errorMessage(cause, 'La création de la source a échoué.');
    if (sourceCreated) {
      sourceDialogVisible.value = false;
      manualImportFile.value = null;
      if (manualImportInput.value) manualImportInput.value.value = '';
      toast.add({
        severity: 'warn',
        summary: 'Source créée, import échoué',
        detail: message,
        life: 10000,
      });
    } else {
      sourceError.value = message;
    }
  } finally {
    sourceSubmitting.value =
      false;
  }
}


const favoritesMode =
  computed(
    () =>
      route.query.favorites ===
      '1',
  );


const pageTitle =
  computed(
    () =>
      favoritesMode.value
        ? 'Mes favoris'
        : 'Éléments de veille',
  );


const pageSubtitle =
  computed(
    () =>
      favoritesMode.value
        ? 'Consultation et recherche dans vos veilles favorites.'
        : 'Recherche, consultation et suivi des informations collectées.',
  );


const items =
  ref<WatchItem[]>([]);

const total =
  ref(0);

const favorites =
  ref<number[]>([]);

const favoriteBusy =
  ref<number[]>([]);

const savedViews =
  ref<SavedView[]>([]);

const saveDialog =
  ref(false);

const viewName =
  ref('');

const viewToDelete =
  ref<SavedView | null>(
    null,
  );

const deletingView =
  ref(false);

const loading =
  ref(false);

const extrasLoading =
  ref(false);

const error =
  ref('');


let searchTimer:
  ReturnType<typeof setTimeout>
  | undefined;

let latestRequest =
  0;

let searchController:
  AbortController
  | undefined;


const filters =
  ref({
    q:
      queryValue(initialListQuery.q),

    status:
      queryValue(initialListQuery.status),

    criticality:
      queryValue(initialListQuery.criticality),

    watchType:
      queryValue(initialListQuery.watchType),

    sourceType:
      queryValue(initialListQuery.sourceType),

    aiQualified:
      queryAiQualification(initialListQuery.aiQualified),

    addedOrder:
      querySortOrder(initialListQuery.addedOrder),

    page:
      queryNumber(initialListQuery.page, 1, 1, 100000),

    limit:
      queryNumber(initialListQuery.limit, 20, 1, 100),

    sortBy:
      querySortBy(initialListQuery.sortBy),

    sortOrder:
      querySortOrder(initialListQuery.addedOrder ?? initialListQuery.sortOrder),

    favoritesOnly:
      initialListQuery.favorites ===
      '1',
  });


function listStateQuery() {
  const query: Record<string, string> = {
    page: String(filters.value.page),
    limit: String(filters.value.limit),
    sortBy: filters.value.sortBy,
    sortOrder: filters.value.sortOrder,
    addedOrder: filters.value.addedOrder,
  };

  for (const key of ['q', 'status', 'criticality', 'watchType', 'sourceType'] as const) {
    if (filters.value[key]) query[key] = filters.value[key];
  }

  if (filters.value.aiQualified) {
    query.aiQualified = filters.value.aiQualified;
  }

  if (filters.value.favoritesOnly) query.favorites = '1';
  return query;
}


async function openWatchItem(itemId: number | string, qualify = false) {
  await router.replace({ name: 'watch-items', query: listStateQuery() });
  const returnTo = router.currentRoute.value.fullPath;
  await router.push({
    name: qualify ? 'watch-item-qualification' : 'watch-item-detail',
    params: { id: itemId },
    query: { returnTo },
  });
}


const statusOptions =
  optionsFr([
    'NOUVEAU',
    'A_QUALIFIER',
    'VALIDE',
    'PUBLIE',
    'ARCHIVE',
    'REJETE',
  ]);


const criticalityOptions =
  optionsFr([
    'FAIBLE',
    'MOYENNE',
    'ELEVEE',
    'CRITIQUE',
  ]);


const watchTypeOptions = computed(() => {
  if (!dbCategories.value.length) {
    return optionsFr([
      'SCIENTIFIQUE',
      'REGLEMENTAIRE',
      'ACCREDITATION',
      'NORMATIF',
      'ENVIRONNEMENT',
      'AUTRE',
    ]);
  }
  return dbCategories.value
    .filter((c) => c.active)
    .map((c) => ({
      label: c.name || labelFr(c.code),
      value: c.code,
    }));
});


const sourceTypeOptions =
  optionsFr([
    'API',
    'RSS',
    'ATOM',
    'IMPORT_MANUEL',
  ]);


const aiQualificationOptions = [
  { label: 'Qualification IA générée', value: 'GENERATED' },
  { label: 'Qualification IA non générée', value: 'NOT_GENERATED' },
];


const addedOrderOptions = [
  { label: 'Du plus récent au plus ancien', value: 'DESC' },
  { label: 'Du plus ancien au plus récent', value: 'ASC' },
];


const canQualify =
  computed(() => {
    const roles =
      auth.user?.roles
      ??
      [];

    return (
      roles.includes(
        'ADMIN',
      )
      ||
      roles.includes(
        'RESPONSABLE_VEILLE',
      )
      ||
      roles.includes(
        'OPERATEUR_VEILLE',
      )
    );
  });


const hasInternalWatchAccess =
  computed(
    () =>
      [
        'ADMIN',
        'RESPONSABLE_VEILLE',
        'REFERENT_LABORATOIRE',
        'OPERATEUR_VEILLE',
      ].some(
        (role) =>
          (
            auth.user?.roles
            ??
            []
          ).includes(
            role,
          ),
      ),
  );


const visibleStatusOptions =
  computed(
    () =>
      hasInternalWatchAccess.value
        ? statusOptions
        : optionsFr([
          'PUBLIE',
        ]),
  );


const dateFormatter =
  new Intl.DateTimeFormat(
    'fr-FR',
    {
      dateStyle:
        'short',

      timeStyle:
        'short',
    },
  );


function formatDate(
  value:
    string
    |
    null,
) {
  if (
    !value
  ) {
    return 'Non renseignée';
  }

  const date =
    new Date(
      value,
    );

  return Number.isNaN(
    date.getTime(),
  )
    ? 'Non renseignée'
    : dateFormatter.format(
      date,
    );
}


function prioritySeverity(
  value:
    string
    |
    null,
) {
  switch (
  value
  ) {
    case 'CRITIQUE':
      return 'danger';

    case 'ELEVEE':
      return 'warn';

    case 'MOYENNE':
      return 'info';

    case 'FAIBLE':
      return 'success';

    default:
      return 'secondary';
  }
}


function errorMessage(
  cause:
    unknown,

  fallback:
    string,
) {
  if (
    typeof cause ===
    'object'
    &&
    cause !==
    null
    &&
    'response' in
    cause
  ) {
    const response =
      (
        cause as {
          response?: {
            data?: {
              message?:
              string
              |
              string[];
            };
          };
        }
      ).response;

    const message =
      response
        ?.data
        ?.message;

    if (
      Array.isArray(
        message,
      )
    ) {
      return message
        .map(
          errorFr,
        )
        .join(
          ' ',
        );
    }

    if (
      typeof message ===
      'string'
    ) {
      return errorFr(
        message,
      );
    }
  }

  return fallback;
}


async function load() {
  const requestId =
    ++latestRequest;

  searchController
    ?.abort();

  searchController =
    new AbortController();

  loading.value =
    true;

  error.value =
    '';

  try {
    const response =
      await searchWatchItems(
        {
          q: filters.value.q,
          status: filters.value.status,
          criticality: filters.value.criticality,
          watchType: filters.value.watchType,
          sourceType: filters.value.sourceType,
          aiQualified: filters.value.aiQualified || undefined,
          page: filters.value.page,
          limit: filters.value.limit,
          sortBy: filters.value.sortBy,
          sortOrder: filters.value.sortOrder,
          favoritesOnly: filters.value.favoritesOnly,
        },
        searchController.signal,
      );

    if (
      requestId !==
      latestRequest
    ) {
      return;
    }

    const result =
      response.data as
      WatchItemSearchResponse;

    items.value =
      result.items;

    total.value =
      result.total;
  } catch (
  cause
  ) {
    if (
      requestId !==
      latestRequest
    ) {
      return;
    }

    if (
      (
        cause as {
          code?:
          string;
        }
      )?.code ===
      'ERR_CANCELED'
    ) {
      return;
    }

    error.value =
      errorMessage(
        cause,
        'Impossible de charger les éléments de veille.',
      );
  } finally {
    if (
      requestId ===
      latestRequest
    ) {
      loading.value =
        false;
    }
  }
}


function scheduleSearch() {
  filters.value.page =
    1;

  if (
    searchTimer
  ) {
    clearTimeout(
      searchTimer,
    );
  }

  searchTimer =
    setTimeout(
      () => {
        void load();
      },
      350,
    );
}


async function loadExtras() {
  extrasLoading.value =
    true;

  try {
    const [
      favoritesResponse,
      viewsResponse,
      categoriesResponse,
    ] =
      await Promise.all([
        getFavorites(),
        getSavedViews(),
        getCategories().catch(() => ({ data: [] as WatchCategory[] })),
      ]);
    if (Array.isArray(categoriesResponse.data)) {
      dbCategories.value = categoriesResponse.data;
      registerCategoryLabels(categoriesResponse.data);
      registerCategoryQueries(categoriesResponse.data);
    }

    favorites.value =
      favoritesResponse.data
        .map(
          (
            favorite: {
              watchItem?: {
                id?:
                number;
              };
            },
          ) =>
            favorite
              .watchItem
              ?.id,
        )
        .filter(
          (
            id:
              number
              |
              undefined,
          ):
            id is number =>
            typeof id ===
            'number',
        );

    window.dispatchEvent(
      new CustomEvent(
        'favorites-changed',
        {
          detail:
            favorites.value.length,
        },
      ),
    );

    savedViews.value =
      viewsResponse.data;
  } catch (
  cause
  ) {
    error.value =
      errorMessage(
        cause,
        'Impossible de charger les favoris et les vues enregistrées.',
      );
  } finally {
    extrasLoading.value =
      false;
  }
}


async function toggleFavorite(
  id:
    number,
) {
  if (
    favoriteBusy.value.includes(
      id,
    )
  ) {
    return;
  }

  favoriteBusy.value = [
    ...favoriteBusy.value,
    id,
  ];

  const wasFavorite =
    favorites.value.includes(
      id,
    );

  try {
    if (
      wasFavorite
    ) {
      await removeFavorite(
        id,
      );
    } else {
      await addFavorite(
        id,
      );
    }

    await loadExtras();

    if (
      filters.value.favoritesOnly
      &&
      wasFavorite
    ) {
      await load();
    }

    toast.add({
      severity:
        'success',

      summary:
        wasFavorite
          ? 'Favori retiré'
          : 'Favori ajouté',

      detail:
        wasFavorite
          ? 'La veille a été retirée de vos favoris.'
          : 'La veille a été ajoutée à vos favoris.',

      life:
        3000,
    });
  } catch (
  cause
  ) {
    toast.add({
      severity:
        'error',

      summary:
        'Modification impossible',

      detail:
        errorMessage(
          cause,
          'Impossible de modifier ce favori.',
        ),

      life:
        4000,
    });
  } finally {
    favoriteBusy.value =
      favoriteBusy.value.filter(
        (itemId) =>
          itemId !==
          id,
      );
  }
}


async function saveView() {
  const name =
    viewName.value.trim();

  if (
    !name
  ) {
    return;
  }

  try {
    await createSavedView({
      name,

      filters: {
        ...filters.value,
      },
    });

    saveDialog.value =
      false;

    viewName.value =
      '';

    await loadExtras();

    toast.add({
      severity:
        'success',

      summary:
        'Vue enregistrée',

      detail:
        `La vue « ${name} » est disponible.`,

      life:
        3000,
    });
  } catch (
  cause
  ) {
    toast.add({
      severity:
        'error',

      summary:
        'Enregistrement impossible',

      detail:
        errorMessage(
          cause,
          'Impossible d’enregistrer cette vue.',
        ),

      life:
        4000,
    });
  }
}


function applyView(
  view:
    SavedView,
) {
  filters.value = {
    ...filters.value,

    ...view.filters,

    page:
      1,

    favoritesOnly:
      favoritesMode.value
        ? true
        : Boolean(
          view.filters
            .favoritesOnly,
        ),
  };
  filters.value.sortBy = querySortBy(filters.value.sortBy);
  filters.value.sortOrder = querySortOrder(filters.value.sortOrder);
  filters.value.addedOrder = filters.value.sortBy === 'collectedAt'
    ? filters.value.sortOrder
    : querySortOrder(filters.value.addedOrder);
}


async function removeSavedView() {
  if (
    !viewToDelete.value
    ||
    deletingView.value
  ) {
    return;
  }

  const selectedView =
    viewToDelete.value;

  deletingView.value =
    true;

  try {
    await deleteSavedView(
      selectedView.id,
    );

    await loadExtras();

    viewToDelete.value =
      null;

    toast.add({
      severity:
        'success',

      summary:
        'Vue supprimée',

      detail:
        `La vue « ${selectedView.name} » a été supprimée.`,

      life:
        3500,
    });
  } catch (
  cause
  ) {
    toast.add({
      severity:
        'error',

      summary:
        'Suppression impossible',

      detail:
        errorMessage(
          cause,
          'Impossible de supprimer cette vue enregistrée.',
        ),

      life:
        4500,
    });
  } finally {
    deletingView.value =
      false;
  }
}


function search() {
  filters.value.page =
    1;

  if (
    searchTimer
  ) {
    clearTimeout(
      searchTimer,
    );
  }

  void load();
}


function resetFilters() {
  filters.value = {
    q:
      '',

    status:
      '',

    criticality:
      '',

    watchType:
      '',

    sourceType:
      '',

    aiQualified:
      '',

    addedOrder:
      'DESC',

    page:
      1,

    limit:
      20,

    sortBy:
      'collectedAt',

    sortOrder:
      'DESC',

    favoritesOnly:
      favoritesMode.value,
  };
  filters.value.sortOrder = filters.value.addedOrder;
}


function changeAddedOrder(order: 'ASC' | 'DESC') {
  filters.value.addedOrder = order;
  filters.value.sortBy = 'collectedAt';
  filters.value.sortOrder = order;
  filters.value.page = 1;
}


function syncUrlWithFilters(replace = false) {
  const query = listStateQuery();
  if (replace) {
    void router.replace({ query });
  } else {
    void router.push({ query });
  }
}

function changePage(
  event: {
    page:
    number;

    rows:
    number;
  },
) {
  filters.value.page =
    event.page + 1;

  filters.value.limit =
    event.rows;

  syncUrlWithFilters(false);
  void load();
}


function changeSort(
  event: {
    sortField?:
    string
    |
    (
      (
        item:
          WatchItem,
      ) => string
    );

    sortOrder?:
    1
    |
    0
    |
    -1
    |
    null;
  },
) {
  if (
    typeof event.sortField !==
    'string'
    ||
    !event.sortOrder
  ) {
    return;
  }

  filters.value.sortBy =
    event.sortField;

  filters.value.sortOrder =
    event.sortOrder ===
      1
      ? 'ASC'
      : 'DESC';

  filters.value.page =
    1;
}


onMounted(
  async () => {
    await Promise.allSettled([
      load(),
      loadExtras(),
    ]);
  },
);


watch(
  () => [
    filters.value.q,
    filters.value.status,
    filters.value.criticality,
    filters.value.watchType,
    filters.value.sourceType,
    filters.value.aiQualified,
    filters.value.addedOrder,
    filters.value.sortBy,
    filters.value.sortOrder,
    filters.value.favoritesOnly,
  ],
  scheduleSearch,
);


watch(
  () => route.query,
  (newQuery) => {
    // Only react when navigating to /watch-items
    if (route.name !== 'watch-items') return;
    const newPage = queryNumber(newQuery.page, 1, 1, 100000);
    const newLimit = queryNumber(newQuery.limit, 20, 1, 100);
    const newFavorites = newQuery.favorites === '1';

    let changed = false;
    if (filters.value.page !== newPage) {
      filters.value.page = newPage;
      changed = true;
    }
    if (filters.value.limit !== newLimit) {
      filters.value.limit = newLimit;
      changed = true;
    }
    if (filters.value.favoritesOnly !== newFavorites) {
      filters.value.favoritesOnly = newFavorites;
      changed = true;
    }

    if (changed) {
      void load();
    }
  },
  { deep: true },
);


onBeforeUnmount(() => {
  if (
    searchTimer
  ) {
    clearTimeout(
      searchTimer,
    );
  }

  searchController
    ?.abort();
});
</script>


<template>
  <AppLayout>

    <div class="watch-page">

      <PageHeader :title="pageTitle
        " :subtitle="pageSubtitle
          " eyebrow="Veille" icon="pi pi-book">
        <template #actions>

          <Button v-if="canTranslateExisting" label="Traduire les veilles existantes" icon="pi pi-language"
            severity="secondary" :loading="translatingExisting" @click="translateExistingBatch" />

          <Button v-if="
            canCreateSource
          " label="Ajouter une source" @click="
            openNewSourceDialog
          ">
            <template #icon>
              <PlusIcon size="0.9rem" />
            </template>
          </Button>

          <Button label="Enregistrer la vue" severity="secondary" @click="
            saveDialog =
            true
            ">
            <template #icon>
              <BookmarkIcon size="0.9rem" />
            </template>
          </Button>

        </template>
      </PageHeader>


      <Message v-if="
        error
      " severity="error" closable @close="
        error = ''
        ">
        {{ error }}
      </Message>


      <SectionCard compact>
        <!-- Search bar always visible -->
        <div class="search-field mb-2">
          <i class="pi pi-search" />
          <InputText
            v-model="filters.q"
            class="w-full"
            placeholder="Rechercher un flux, un titre ou un résumé..."
            @keyup.enter="search"
          />
        </div>

        <!-- Mobile Quick Pill Filters -->
        <div class="mobile-pills-bar">
          <button
            type="button"
            class="mobile-filter-pill"
            :class="{ active: !filters.criticality && !filters.status && !filters.favoritesOnly }"
            @click="quickFilter('all')"
          >
            Tous
          </button>
          <button
            type="button"
            class="mobile-filter-pill pill-critical"
            :class="{ active: filters.criticality === 'CRITIQUE' }"
            @click="quickFilter('critical')"
          >
            <i class="pi pi-exclamation-triangle" />
            Critiques
          </button>
          <button
            type="button"
            class="mobile-filter-pill pill-high"
            :class="{ active: filters.criticality === 'ELEVEE' }"
            @click="quickFilter('high')"
          >
            <i class="pi pi-info-circle" />
            Élevées
          </button>
          <button
            type="button"
            class="mobile-filter-pill pill-qualify"
            :class="{ active: filters.status === 'A_QUALIFIER' }"
            @click="quickFilter('to_qualify')"
          >
            <i class="pi pi-clock" />
            À qualifier
          </button>
          <button
            type="button"
            class="mobile-filter-pill pill-fav"
            :class="{ active: filters.favoritesOnly }"
            @click="quickFilter('favorites')"
          >
            <i class="pi pi-star-fill text-amber-400" />
            Favoris
          </button>
          <button
            type="button"
            class="mobile-filter-pill pill-more"
            :class="{ active: mobileFiltersExpanded }"
            @click="mobileFiltersExpanded = !mobileFiltersExpanded"
          >
            <i class="pi pi-sliders-h" />
            {{ mobileFiltersExpanded ? 'Masquer' : 'Filtres +' }}
          </button>
        </div>

        <div class="filters-grid" :class="{ 'mobile-filters-hidden': !mobileFiltersExpanded }">
          <div class="select-host">
            <Select append-to="self" v-model="filters.status" :options="visibleStatusOptions" option-label="label" option-value="value" show-clear placeholder="Statut" class="w-full" />
          </div>

          <div class="select-host">
            <Select append-to="self" v-model="filters.criticality" :options="criticalityOptions" option-label="label" option-value="value" show-clear placeholder="Importance" class="w-full" />
          </div>

          <div class="select-host">
            <Select append-to="self" v-model="filters.watchType" :options="watchTypeOptions" option-label="label" option-value="value" show-clear placeholder="Type de veille" class="w-full" />
          </div>

          <div class="select-host">
            <Select append-to="self" v-model="filters.sourceType" :options="sourceTypeOptions" option-label="label" option-value="value" show-clear placeholder="Type de source" class="w-full" />
          </div>

          <div class="select-host">
            <Select append-to="self" v-model="filters.aiQualified" :options="aiQualificationOptions" option-label="label" option-value="value" show-clear placeholder="Qualification IA" class="w-full" />
          </div>

          <div class="select-host">
            <Select append-to="self" :model-value="filters.addedOrder" :options="addedOrderOptions" option-label="label" option-value="value" class="w-full" aria-label="Trier les éléments par date d’ajout" @update:model-value="changeAddedOrder" />
          </div>

          <Button label="Réinitialiser" icon="pi pi-filter-slash" severity="secondary" text @click="resetFilters" />
        </div>
      </SectionCard>


      <div v-if="
        savedViews.length
        ||
        extrasLoading
      " class="saved-views">

        <span class="saved-title">
          <BookmarkIcon size="0.8rem" />

          Vues enregistrées
        </span>


        <div v-for="
view in
  savedViews
          " :key="view.id
            " class="saved-chip">

          <button type="button" @click="
            applyView(
              view,
            )
            ">
            {{ view.name }}
          </button>


          <button type="button" aria-label="Supprimer" @click="
            viewToDelete =
            view
            ">
            <TrashIcon size="0.7rem" />
          </button>

        </div>


        <AppSpinner v-if="
          extrasLoading
        " size="small" label="Chargement…" />

      </div>


      <SectionCard :title="`${total} élément${total > 1 ? 's' : ''}`
        " subtitle="Informations collectées et disponibles dans la plateforme." icon="pi pi-list">

        <DataTable class="watch-table desktop-table-only" scrollable table-style="min-width: 65rem" :value="items
          " :loading="loading
            " data-key="id" lazy paginator :first="(
              filters.page - 1
            )
              *
              filters.limit
              " :rows="filters.limit
                " :rows-per-page-options="[
                  10,
                  20,
                  50,
                ]
                  " :total-records="total
                    " :sort-field="filters.sortBy
                      " :sort-order="filters.sortOrder ===
                      'ASC'
                      ? 1
                      : -1
                      " @page="
                      changePage
                    " @sort="
                    changeSort
                  ">

          <template #empty>
            Aucun élément ne correspond aux critères sélectionnés.
          </template>


          <Column header="Flux" sort-field="sourceName" sortable style="min-width: 10rem">
            <template #body="{ data }">

              <div class="source-cell">
                <strong>
                  {{
                    data.source?.name
                    ??
                    'Non renseigné'
                  }}
                </strong>

                <span>
                  {{
                    labelFr(
                      data.watchType,
                    )
                  }}
                </span>
              </div>

            </template>
          </Column>


          <Column header="Type de source" sort-field="sourceType" sortable style="min-width: 8rem">
            <template #body="{ data }">
              <SourceTypeBadge :type="data.source
                ?.sourceType
                " />
            </template>
          </Column>


          <Column field="title" header="Titre" sortable style="min-width: 15rem">
            <template #body="{ data }">

              <button type="button" class="title-link" @click="openWatchItem(data.id)">
                <span v-html="titleHtml(data.title)" />
              </button>

            </template>
          </Column>


          <Column header="Publication" sort-field="publishedAt" sortable style="min-width: 8rem">
            <template #body="{ data }">
              <span class="date-text">
                {{
                  formatDate(
                    data.publishedAt,
                  )
                }}
              </span>
            </template>
          </Column>


          <Column header="Résumé" style="min-width: 14rem">
            <template #body="{ data }">
              <p class="watch-summary">
                {{
                  stripHtmlTags(data.summary)
                  ||
                  'Aucun résumé disponible.'
                }}
              </p>
            </template>
          </Column>


          <Column header="Importance" sort-field="relevance" sortable style="min-width: 8.5rem">
            <template #body="{ data }">

              <Tag :value="data.criticality
                ? labelFr(
                  data.criticality,
                )
                : 'Non qualifiée'
                " :severity="prioritySeverity(
                  data.criticality,
                )
                  " />

            </template>
          </Column>


          <Column header="Statut" sort-field="status" sortable style="min-width: 7.5rem">
            <template #body="{ data }">
              <StatusBadge :status="data.status
                " />
            </template>
          </Column>


          <Column header="Actions" style="min-width: 6rem">
            <template #body="{ data }">

              <div class="table-actions">

                <Button severity="secondary" rounded size="small" aria-label="Voir la veille" title="Voir la veille"
                  @click="openWatchItem(data.id)">
                  <template #icon>
                    <ArrowRightIcon size="0.8rem" />
                  </template>
                </Button>


                <Button v-if="
                  canQualify
                  &&
                  [
                    'NOUVEAU',
                    'A_QUALIFIER',
                  ].includes(
                    data.status,
                  )
                " severity="secondary" rounded size="small" aria-label="Qualifier" title="Qualifier"
                  @click="openWatchItem(data.id, true)">
                  <template #icon>
                    <CheckCircleIcon size="0.8rem" />
                  </template>
                </Button>


                <Button severity="secondary" rounded size="small" :aria-label="favorites.includes(
                  data.id,
                )
                  ? 'Retirer des favoris'
                  : 'Ajouter aux favoris'
                  " :title="favorites.includes(
                    data.id,
                  )
                    ? 'Retirer des favoris'
                    : 'Ajouter aux favoris'
                    " :loading="favoriteBusy.includes(
                      data.id,
                    )
                      " @click="
                        toggleFavorite(
                          data.id,
                        )
                        ">
                  <template #icon>

                    <StarFillIcon v-if="
                      favorites.includes(
                        data.id,
                      )
                    " size="0.8rem" />

                    <StarIcon v-else size="0.8rem" />

                  </template>
                </Button>


                <Button v-if="
                  safeExternalUrl(data.url)
                " as="a" :href="safeExternalUrl(data.url)
                  " target="_blank" rel="noopener noreferrer" severity="secondary" rounded size="small"
                  aria-label="Ouvrir la source" title="Ouvrir la source">
                  <template #icon>
                    <ExternalLinkIcon size="0.8rem" />
                  </template>
                </Button>

              </div>

            </template>
          </Column>

        </DataTable>

        <!-- Executive Card Flow (Mobile ONLY - Proposition 1) -->
        <div class="executive-card-flow mobile-card-only">
          <div v-if="items.length === 0 && !loading" class="empty-feed-card">
            <i class="pi pi-inbox text-3xl opacity-40 mb-2"></i>
            <p>Aucun élément ne correspond aux critères sélectionnés.</p>
            <Button label="Réinitialiser les filtres" severity="secondary" size="small" class="mt-2" @click="resetFilters" />
          </div>

          <article
            v-for="item in items"
            :key="item.id"
            class="executive-watch-card"
            @click="openWatchItem(item.id)"
          >
            <!-- Card Top: Tag Urgence + Source tag + Favorite -->
            <div class="card-header-bar">
              <div class="card-badges">
                <Tag
                  :value="item.criticality ? labelFr(item.criticality) : 'Non qualifiée'"
                  :severity="prioritySeverity(item.criticality)"
                  class="urgency-pill font-semibold"
                />
                <span class="source-bubble" :title="item.source?.name">
                  {{ item.source?.name ?? 'Source générale' }}
                </span>
              </div>
              <div class="card-meta-top">
                <span class="card-date">{{ formatDate(item.publishedAt || item.collectedAt) }}</span>
                <button
                  type="button"
                  class="card-fav-btn"
                  :class="{ active: favorites.includes(item.id) }"
                  :aria-label="favorites.includes(item.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'"
                  @click.stop="toggleFavorite(item.id)"
                >
                  <StarFillIcon v-if="favorites.includes(item.id)" size="0.95rem" class="text-amber-400" />
                  <StarIcon v-else size="0.95rem" class="text-slate-400" />
                </button>
              </div>
            </div>

            <!-- Card Title -->
            <h3 class="card-title">
              <span v-html="titleHtml(item.title)" />
            </h3>

            <!-- Card Summary (2 lines clamp) -->
            <p class="card-summary">
              {{ stripHtmlTags(item.summary) || 'Aucun résumé disponible pour cet élément de veille.' }}
            </p>

            <!-- Card Meta row: Type de veille + Statut + Score -->
            <div class="card-meta-pills">
              <span class="type-pill">
                <i class="pi pi-compass text-xs mr-1 opacity-75"></i>
                {{ labelFr(item.watchType) }}
              </span>
              <StatusBadge :status="item.status" />
              <span v-if="(item.relevanceScore ?? item.relevance) !== undefined && (item.relevanceScore ?? item.relevance) !== null" class="score-pill">
                <i class="pi pi-bolt text-emerald-400 text-xs mr-1"></i>
                {{ Math.round(Number(item.relevanceScore ?? item.relevance) <= 1 && Number(item.relevanceScore ?? item.relevance) > 0 ? Number(item.relevanceScore ?? item.relevance) * 100 : Number(item.relevanceScore ?? item.relevance)) }}%
              </span>
            </div>

            <!-- Card Actions Footer -->
            <div class="card-action-bar" @click.stop>
              <Button
                label="Consulter"
                icon="pi pi-arrow-right"
                icon-pos="right"
                size="small"
                class="executive-btn-primary"
                @click="openWatchItem(item.id)"
              />
              <Button
                v-if="canQualify && ['NOUVEAU', 'A_QUALIFIER'].includes(item.status)"
                label="Qualifier"
                icon="pi pi-check-circle"
                severity="secondary"
                size="small"
                class="executive-btn-secondary"
                @click="openWatchItem(item.id, true)"
              />
              <Button
                v-if="safeExternalUrl(item.url)"
                as="a"
                :href="safeExternalUrl(item.url)"
                target="_blank"
                rel="noopener noreferrer"
                severity="secondary"
                size="small"
                icon="pi pi-external-link"
                class="executive-btn-icon"
                title="Ouvrir la source externe"
              />
            </div>
          </article>

          <!-- Mobile Pagination -->
          <div v-if="total > filters.limit" class="mobile-pagination-ctrl">
            <Button
              icon="pi pi-chevron-left"
              label="Précédent"
              severity="secondary"
              size="small"
              :disabled="filters.page <= 1"
              @click="changePage({ page: filters.page - 2, rows: filters.limit })"
            />
            <span class="pagination-info">
              {{ filters.page }} / {{ Math.ceil(total / filters.limit) }}
            </span>
            <Button
              icon="pi pi-chevron-right"
              icon-pos="right"
              label="Suivant"
              severity="secondary"
              size="small"
              :disabled="filters.page >= Math.ceil(total / filters.limit)"
              @click="changePage({ page: filters.page, rows: filters.limit })"
            />
          </div>
        </div>

      </SectionCard>


      <Dialog v-model:visible="saveDialog
        " modal header="Enregistrer la vue" class="w-full max-w-md">
        <form class="space-y-4" @submit.prevent="
          saveView
        ">

          <div>
            <label for="saved-view-name" class="required-label mb-2 block">
              Nom de la vue
            </label>

            <InputText id="saved-view-name" v-model="viewName
              " class="w-full" placeholder="Exemple : Veilles critiques" maxlength="150" autofocus />
          </div>


          <div class="dialog-actions">

            <Button type="button" label="Annuler" severity="secondary" @click="
              saveDialog =
              false
              " />

            <Button type="submit" label="Enregistrer" :disabled="!viewName.trim()
              " />

          </div>

        </form>
      </Dialog>


      <Dialog :visible="Boolean(
        viewToDelete,
      )
        " modal header="Supprimer la vue" class="w-full max-w-md" :closable="!deletingView
          " :close-on-escape="!deletingView
            " @update:visible="
              (
                visible,
              ) => {
                if (
                  !visible
                  &&
                  !deletingView
                ) {
                  viewToDelete =
                    null;
                }
              }
            ">

        <p>
          Êtes-vous sûr de vouloir supprimer
          <strong>
            « {{ viewToDelete?.name }} »
          </strong>
          ?
        </p>

        <div class="dialog-actions">

          <Button label="Annuler" severity="secondary" :disabled="deletingView
            " @click="
              viewToDelete =
              null
              " />

          <Button label="Supprimer" severity="danger" :loading="deletingView
            " @click="
              removeSavedView
            " />

        </div>

      </Dialog>


      <Dialog v-model:visible="sourceDialogVisible
        " modal header="Nouvelle source" class="watch-source-dialog w-full max-w-2xl">

        <form id="watch-source-form" class="space-y-4" @submit.prevent="submitSource">
          <div class="source-mode-segmented" role="tablist" aria-label="Mode d'ajout de source">
            <button type="button" class="source-mode-btn" :class="{ active: sourceCreationMode === 'DIRECT' }"
              @click="switchSourceCreationMode('DIRECT')">
              Flux RSS / Atom, API et Import manuel
            </button>
            <button type="button" class="source-mode-btn" :class="{ active: sourceCreationMode === 'WEB_PAGE' }"
              @click="switchSourceCreationMode('WEB_PAGE')">
              Lien de page web (auto-détection HTML)
            </button>
          </div>

          <Message v-if="sourceError" severity="error">
            {{ sourceError }}
          </Message>

          <template v-if="sourceCreationMode === 'WEB_PAGE'">
            <div>
              <label class="required-label mb-2 block">
                Lien de la page web à surveiller
              </label>
              <div class="flex gap-2">
                <InputText v-model="webPageUrl" class="w-full"
                  placeholder="Ex. : https://www.iso.org/fr/standard/75100.html" required
                  @blur="webPageUrl.trim() && !discoveredInfo && analyzeWebPageUrl()" />
                <Button type="button" label="Analyser le lien" severity="secondary" class="shrink-0"
                  :loading="analyzingWebUrl" :disabled="!webPageUrl.trim() || analyzingWebUrl"
                  @click="analyzeWebPageUrl" />
              </div>
              <p class="helper-text">
                Collez directement l’adresse depuis la barre de recherche du navigateur (ISO, ANSES, revue, page HTML
                statique…).
              </p>
            </div>

            <div v-if="discoveredInfo" class="discovered-feed-banner">
              <div class="discovered-feed-title">
                <CheckCircleIcon size="0.9rem" />
                <span>{{ discoveredInfo.message }}</span>
              </div>
              <div class="discovered-feed-url">
                {{ discoveredInfo.resolvedUrl }}
              </div>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <label class="required-label mb-2 block">Nom</label>
                <InputText v-model="sourceForm.name" class="w-full" required />
              </div>
              <div>
                <label class="mb-2 block">Organisme</label>
                <InputText v-model="sourceForm.organization" class="w-full" />
              </div>
              <div>
                <label class="mb-2 block">Pays</label>
                <InputText v-model="sourceForm.country" class="w-full" />
              </div>
              <div>
                <label class="required-label mb-2 block">Catégorie</label>
                <div class="select-host">
                  <Select append-to="self" v-model="sourceForm.category" :options="sourceCategoryDropdownItems"
                    option-label="label" option-value="value" scroll-height="18rem" class="w-full" required />
                </div>
              </div>
              <div>
                <label class="mb-2 block">Fréquence</label>
                <InputText v-model="sourceForm.frequency" class="w-full" placeholder="Ex. : 30m, 6h ou 1j" />
                <p class="helper-text">m : minutes · h : heures · j : jours</p>
              </div>
              <div>
                <label class="mb-2 block">Sujet à surveiller</label>
                <InputText v-model="targetQuery" class="w-full"
                  placeholder="Ex. : environnement, ISO 17025, laboratoire, microbiologie" />
                <p class="helper-text">Séparez les sujets par des virgules.</p>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <label class="required-label mb-2 block">Nom</label>
                <InputText v-model="sourceForm.name" class="w-full" required />
              </div>

              <div>
                <label class="mb-2 block">Organisme</label>
                <InputText v-model="sourceForm.organization" class="w-full" />
              </div>

              <div>
                <label class="mb-2 block">Pays</label>
                <InputText v-model="sourceForm.country" class="w-full" />
              </div>

              <div>
                <label class="required-label mb-2 block">Catégorie</label>
                <div class="select-host">
                  <Select append-to="self" v-model="sourceForm.category" :options="sourceCategoryDropdownItems"
                    option-label="label" option-value="value" scroll-height="18rem" class="w-full" required />
                </div>
              </div>

              <div>
                <label class="required-label mb-2 block">Type</label>
                <div class="select-host">
                  <Select append-to="self" v-model="sourceForm.sourceType"
                    :options="optionsFr(sourceCreationTypeOptions)" option-label="label" option-value="value"
                    scroll-height="18rem" class="w-full" required @update:model-value="applyManualSourceDefaults"
                    @change="(event) => applyManualSourceDefaults(event.value)" />
                </div>
              </div>

              <div v-if="sourceForm.sourceType !== 'IMPORT_MANUEL'">
                <label class="mb-2 block">Fréquence</label>
                <InputText v-model="sourceForm.frequency" class="w-full" placeholder="Ex. : 30m, 6h ou 1j" />
                <p class="helper-text">m : minutes · h : heures · j : jours</p>
              </div>
            </div>

            <div v-if="sourceForm.sourceType !== 'IMPORT_MANUEL'">
              <label class="required-label mb-2 block">Adresse de la source</label>
              <InputText v-model="sourceForm.baseUrl" class="w-full" placeholder="https://..." required />
              <p v-if="sourceForm.sourceType === 'API'" class="helper-text">
                Crossref est proposé ; vous pouvez saisir une autre URL API renvoyant une liste JSON d’articles.
              </p>
              <p v-else class="helper-text">
                Utilisez l’adresse exacte du flux. Son contenu XML, JSON ou CSV est détecté automatiquement.
              </p>
            </div>

            <div v-if="sourceForm.sourceType !== 'IMPORT_MANUEL'">
              <label class="mb-2 block">Sujet à surveiller</label>
              <InputText v-model="targetQuery" class="w-full"
                placeholder="Ex. : environnement, ISO 17025, laboratoire, microbiologie" />
              <p class="helper-text">Séparez les sujets par des virgules.</p>
            </div>

            <Message v-if="sourceForm.sourceType === 'IMPORT_MANUEL'" severity="info" :closable="false">
              Le fichier sélectionné sera importé immédiatement après la création de la source.
            </Message>

            <div v-if="sourceForm.sourceType === 'IMPORT_MANUEL'">
              <label for="watch-manual-import-file" class="required-label mb-2 block">Fichier à importer</label>
              <input id="watch-manual-import-file" ref="manualImportInput" type="file" required
                accept=".pdf,.csv,.xlsx,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                @change="selectManualImportFile" />
              <p class="helper-text">
                CSV, XLSX ou PDF · 5 Mo maximum. Pour un PDF, utilisez un bloc par veille avec une ligne vide entre les
                blocs.
              </p>
            </div>
          </template>
        </form>

        <template #footer>
          <div class="source-dialog-footer">
            <div class="dialog-actions">
              <Button type="button" label="Annuler" severity="secondary" @click="sourceDialogVisible = false" />
              <Button type="submit" form="watch-source-form" label="Créer la source" :loading="sourceSubmitting" />
            </div>
          </div>
        </template>

      </Dialog>

    </div>

  </AppLayout>
</template>


<style scoped>
:global(.watch-source-dialog) {
  max-height: calc(100dvh - 1.5rem);
  width: min(50rem, calc(100vw - 2rem)) !important;
  max-width: min(50rem, calc(100vw - 2rem)) !important;
}

:global(.watch-source-dialog .p-dialog-content) {
  min-height: 0;
  overflow-y: auto !important;
  padding-bottom: 1.5rem !important;
}

:global(.watch-source-dialog .p-dialog-content:has(.p-select-overlay)) {
  overflow: visible !important;
}

:global(.watch-source-dialog .p-dialog-footer) {
  flex: none;
  border-top: 1px solid var(--app-border);
  background: var(--app-surface);
}

.source-mode-segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
  padding: 0.3rem;
  border-radius: 0.65rem;
  border: 1px solid var(--app-border-strong);
  background: var(--app-segmented-bg);
}

.source-mode-btn {
  padding: 0.55rem 0.75rem;
  border-radius: 0.45rem;
  border: none;
  background: transparent;
  color: var(--app-segmented-btn-text);
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.source-mode-btn:hover:not(.active) {
  background: var(--app-surface-3);
  color: var(--app-text);
}

.source-mode-btn.active {
  background: var(--app-segmented-btn-active-bg);
  color: var(--app-segmented-btn-active-text);
  font-weight: 700;
}

.discovered-feed-banner {
  padding: 0.7rem 0.9rem;
  border-radius: 0.55rem;
  border: 1px solid var(--app-banner-success-border);
  background: var(--app-banner-success-bg);
  display: grid;
  gap: 0.25rem;
}

.discovered-feed-title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--app-banner-success-title);
  font-size: 0.78rem;
  font-weight: 600;
}

.discovered-feed-url {
  color: var(--app-banner-success-text);
  font-size: 0.74rem;
  word-break: break-all;
}

.source-dialog-footer {
  display: grid;
  width: 100%;
  gap: .7rem;
}

.source-connector-choice {
  display: flex;
  align-items: center;
  gap: .55rem;
  color: var(--app-text-secondary);
  font-size: .75rem;
  cursor: pointer;
}

.watch-page {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
}

.filters-grid {
  display: grid;

  grid-template-columns:
    minmax(16rem, 2fr) repeat(4, minmax(10.5rem, 1fr));

  gap:
    0.65rem;

  align-items:
    center;
}

.search-field {
  position:
    relative;

  display:
    flex;

  align-items:
    center;
}

.search-field i {
  position:
    absolute;

  left:
    0.8rem;

  z-index:
    2;

  color:
    var(--app-text-muted);

  font-size:
    0.72rem;
}

.search-field :deep(input) {
  padding-left:
    2.2rem;
}

.saved-views {
  display:
    flex;

  flex-wrap:
    wrap;

  align-items:
    center;

  gap:
    0.5rem;

  padding:
    0.65rem 0.8rem;

  border:
    1px solid var(--app-border);

  border-radius:
    0.8rem;

  background:
    var(--app-surface);
}

.saved-title {
  display:
    inline-flex;

  align-items:
    center;

  gap:
    0.35rem;

  margin-right:
    0.25rem;

  color:
    var(--app-text-muted);

  font-size:
    0.7rem;

  font-weight:
    700;
}

.saved-chip {
  display:
    flex;

  overflow:
    hidden;

  border-radius:
    0.65rem;

  background:
    var(--app-surface-2);
}

.saved-chip button {
  border:
    0;

  background:
    transparent;

  color:
    var(--app-text-secondary);

  padding:
    0.45rem 0.65rem;

  font-size:
    0.7rem;

  cursor:
    pointer;
}

.saved-chip button:hover {
  color:
    var(--app-primary);
}

.source-cell {
  display:
    grid;

  gap:
    0.12rem;
}

.source-cell strong {
  color:
    var(--app-text);

  font-size:
    0.75rem;
}

.source-cell span,
.date-text,
.helper-text {
  color:
    var(--app-text-muted);

  font-size:
    0.68rem;
}

.title-link {
  border:
    0;

  background:
    transparent;

  color:
    var(--app-text);

  font-size:
    0.76rem;

  font-weight:
    650;

  line-height:
    1.4;

  text-align:
    left;

  cursor:
    pointer;
}

.title-link:hover {
  color:
    var(--app-primary);
}

.watch-summary {
  display:
    -webkit-box;

  overflow:
    hidden;

  margin:
    0;

  color:
    var(--app-text-muted);

  font-size:
    0.72rem;

  line-height:
    1.45;

  -webkit-box-orient:
    vertical;

  -webkit-line-clamp:
    2;
}

.table-actions {
  display:
    flex;

  flex-wrap:
    wrap;

  gap:
    0.35rem;
}

.dialog-actions {
  display:
    flex;

  justify-content:
    flex-end;

  gap:
    0.65rem;

  margin-top:
    1rem;
}

.watch-table :deep(th),
.watch-table :deep(td) {
  overflow-wrap: normal;
}

.watch-table :deep(.p-datatable-column-header-content) {
  flex-wrap: nowrap;
  white-space: nowrap;
}

.watch-table :deep(.source-badge),
.watch-table :deep(.status-badge),
.watch-table :deep(.p-tag) {
  max-width: 100%;
  white-space: normal;
}

.mobile-filter-toggle {
  display: none;
  margin-bottom: 0.5rem;
}

/* Mobile Pills Bar */
.mobile-pills-bar {
  display: none;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.4rem;
  margin-bottom: 0.75rem;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.mobile-pills-bar::-webkit-scrollbar {
  display: none;
}
.mobile-filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.85rem;
  border-radius: 9999px;
  font-size: 0.8rem;
  font-weight: 500;
  white-space: nowrap;
  background: var(--app-surface-2, #13243a);
  border: 1px solid var(--app-border, rgba(148, 163, 184, 0.15));
  color: var(--app-text-secondary, #cbd5e1);
  cursor: pointer;
  transition: all 0.15s ease;
}
.mobile-filter-pill:hover,
.mobile-filter-pill:active {
  background: var(--app-surface-3, #192c45);
  color: #ffffff;
}
.mobile-filter-pill.active {
  background: rgba(16, 185, 129, 0.18);
  border-color: #10b981;
  color: #34d399;
  font-weight: 600;
}
.mobile-filter-pill.pill-critical.active {
  background: rgba(239, 68, 68, 0.18);
  border-color: #ef4444;
  color: #f87171;
}
.mobile-filter-pill.pill-high.active {
  background: rgba(245, 158, 11, 0.18);
  border-color: #f59e0b;
  color: #fbbf24;
}
.mobile-filter-pill.pill-qualify.active {
  background: rgba(59, 130, 246, 0.18);
  border-color: #3b82f6;
  color: #60a5fa;
}
.mobile-filter-pill.pill-fav.active {
  background: rgba(251, 191, 36, 0.18);
  border-color: #fbbf24;
  color: #fde047;
}

/* Executive Card Flow */
.mobile-card-only {
  display: none;
}
.desktop-table-only {
  display: block;
}

.executive-card-flow {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.executive-watch-card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--app-surface);
  border: 1px solid var(--app-border-strong);
  border-radius: 1rem;
  padding: 1rem;
  box-shadow: var(--app-shadow-soft);
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.executive-watch-card:hover {
  box-shadow: var(--app-shadow);
  border-color: var(--app-primary);
}

.executive-watch-card:active {
  transform: scale(0.99);
  border-color: var(--app-primary);
}

.card-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.card-badges {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  min-width: 0;
}

.source-bubble {
  font-size: 0.72rem;
  color: var(--app-text-secondary);
  background: var(--app-surface-2);
  padding: 0.2rem 0.5rem;
  border-radius: 0.4rem;
  border: 1px solid var(--app-border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.card-meta-top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.card-date {
  font-size: 0.72rem;
  color: var(--app-text-muted);
  white-space: nowrap;
}

.card-fav-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: transform 0.15s ease;
}

.card-fav-btn:active {
  transform: scale(1.2);
}

.card-title {
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.4;
  color: var(--app-text);
  margin: 0 0 0.45rem 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-summary {
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--app-text-muted);
  margin: 0 0 0.75rem 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-meta-pills {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-bottom: 0.85rem;
}

.type-pill {
  display: inline-flex;
  align-items: center;
  font-size: 0.72rem;
  color: var(--app-text-secondary);
  background: var(--app-surface-2);
  padding: 0.2rem 0.55rem;
  border-radius: 9999px;
  border: 1px solid var(--app-border);
}

.score-pill {
  display: inline-flex;
  align-items: center;
  font-size: 0.72rem;
  font-weight: 600;
  color: #34d399;
  background: rgba(6, 78, 59, 0.4);
  padding: 0.2rem 0.55rem;
  border-radius: 9999px;
  border: 1px solid rgba(52, 211, 153, 0.25);
}

.card-action-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-top: 0.65rem;
  border-top: 1px solid var(--app-border);
}

.executive-btn-primary {
  flex: 1;
  background: #10b981 !important;
  border-color: #10b981 !important;
  color: #ffffff !important;
  font-weight: 600 !important;
  border-radius: 0.6rem !important;
}

.executive-btn-primary:active {
  background: #059669 !important;
}

.executive-btn-secondary {
  border-radius: 0.6rem !important;
}

.executive-btn-icon {
  border-radius: 0.6rem !important;
}

.mobile-pagination-ctrl {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 0.25rem 0.25rem 0.25rem;
}

.pagination-info {
  font-size: 0.82rem;
  font-weight: 600;
  color: #94a3b8;
}

.empty-feed-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1rem;
  text-align: center;
  color: #94a3b8;
  font-size: 0.88rem;
}

@media (max-width: 1500px) {
  .filters-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 860px) {
  .desktop-table-only {
    display: none !important;
  }

  .mobile-card-only {
    display: flex !important;
  }

  .mobile-pills-bar {
    display: flex !important;
  }

  .filters-grid {
    grid-template-columns: 1fr;
    gap: 0.65rem;
  }

  .filters-grid.mobile-filters-hidden {
    display: none !important;
  }
}
</style>

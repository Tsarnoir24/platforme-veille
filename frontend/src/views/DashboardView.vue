<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { useRouter } from 'vue-router';

import Message from 'primevue/message';
import Button from 'primevue/button';
import Select from 'primevue/select';
import Tag from 'primevue/tag';

import AppLayout from '../layouts/AppLayout.vue';
import PageHeader from '../components/ui/PageHeader.vue';

import MetricCard from '../components/dashboard/MetricCard.vue';
import TrendChart from '../components/dashboard/TrendChart.vue';
import DistributionChart from '../components/dashboard/DistributionChart.vue';

import {
  getDashboard,
  getDashboardAnalytics,
  type DashboardAnalytics,
  type DashboardStats,
} from '../services/dashboard.service';

import {
  useAuthStore,
} from '../stores/auth';
import { stripHtmlTags } from '../utils/clean-text';


const auth =
  useAuthStore();
const router = useRouter();

function openWatchItem(id: number) {
  void router.push({
    name: 'watch-item-detail',
    params: { id },
    query: { returnTo: '/' },
  });
}

function openActionWatchItem(action: { watchItemId?: number }) {
  if (action.watchItemId) {
    openWatchItem(action.watchItemId);
  } else {
    void router.push('/actions');
  }
}

const stats =
  ref<DashboardStats>({});

const kpisCollapsed = ref(false);

const analytics =
  ref<DashboardAnalytics | null>(
    null,
  );

const loading =
  ref(true);

const analyticsLoading = ref(true);
const analyticsError = ref('');

const error =
  ref('');

const period =
  ref(30);


const periods = [
  {
    label:
      '7 derniers jours',
    value:
      7,
  },
  {
    label:
      '30 derniers jours',
    value:
      30,
  },
  {
    label:
      '3 derniers mois',
    value:
      90,
  },
  {
    label:
      '12 derniers mois',
    value:
      365,
  },
];


const labels:
  Record<string, string> = {

  sourcesActive:
    'Sources actives',

  sourcesInactive:
    'Sources inactives',

  usersActive:
    'Utilisateurs actifs',

  toValidate:
    'Veilles à valider',

  critical:
    'Veilles importantes',

  openActions:
    'Actions ouvertes',

  collectionErrors:
    'Erreurs de collecte',

  published:
    'Veilles publiées',

  criticalPublished:
    'Publications importantes',

  validated:
    'Veilles validées à publier',

  recentCollections:
    'Collectes sur la période',

  newItems:
    'Nouvelles veilles',

  toQualify:
    'Veilles à qualifier',

  qualified:
    'Veilles traitées',

  assignedOpenActions:
    'Mes actions en cours',

  assignedLateActions:
    'Mes actions en retard',

  recentlyPublished:
    'Publiées sur la période',

  unreadNotifications:
    'Notifications non lues',
};


const dashboardRole =
  computed(() => {
    const roles =
      auth.user?.roles ?? [];

    if (
      roles.includes(
        'ADMIN',
      )
    ) {
      return 'Pilotage administratif';
    }

    if (
      roles.includes(
        'RESPONSABLE_VEILLE',
      )
    ) {
      return 'Pilotage de la veille';
    }

    if (
      roles.includes(
        'OPERATEUR_VEILLE',
      )
    ) {
      return 'Collecte et qualification';
    }

    if (
      roles.includes(
        'REFERENT_LABORATOIRE',
      )
    ) {
      return 'Suivi du laboratoire';
    }

    return 'Consultation';
  });


const topSourcesTitle =
  computed(() => {
    const roles =
      auth.user?.roles ?? [];

    const canSeeInternalItems =
      roles.some(
        (role) =>
          [
            'ADMIN',
            'RESPONSABLE_VEILLE',
            'OPERATEUR_VEILLE',
          ].includes(
            role,
          ),
      );

    return canSeeInternalItems
      ? 'Sources les plus actives'
      : 'Sources les plus publiées';
  });


const cards =
  computed(
    () =>
      Object.entries(
        stats.value,
      ).map(
        ([key, value]) => ({
          key,
          label:
            labels[key] ?? key,
          value,
        }),
      ),
  );


const dangerKeys =
  new Set([
    'collectionErrors',
    'assignedLateActions',
    'critical',
    'criticalPublished',
  ]);


const warningKeys =
  new Set([
    'toValidate',
    'toQualify',
    'newItems',
    'openActions',
    'validated',
    'unreadNotifications',
  ]);


const infoKeys =
  new Set([
    'recentCollections',
    'recentlyPublished',
  ]);


let refreshTimer:
  ReturnType<typeof setInterval>
  | undefined;

let refreshing =
  false;

let pendingRefresh = false;
let loadedAnalyticsPeriod: number | null = null;


function tone(
  key: string,
):
  'success'
  | 'warning'
  | 'danger'
  | 'info' {

  if (
    dangerKeys.has(
      key,
    )
  ) {
    return 'danger';
  }

  if (
    warningKeys.has(
      key,
    )
  ) {
    return 'warning';
  }

  if (
    infoKeys.has(
      key,
    )
  ) {
    return 'info';
  }

  return 'success';
}


function readable(
  value: string,
) {
  return value
    .replaceAll(
      '_',
      ' ',
    )
    .toLocaleLowerCase(
      'fr-FR',
    )
    .replace(
      /^./,
      (letter) =>
        letter.toUpperCase(),
    );
}


function formatDate(
  value:
    string
    | null,
) {
  if (!value) {
    return 'Sans échéance';
  }

  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T00:00:00`
      : value,
  );

  if (Number.isNaN(date.getTime())) {
    return 'Sans échéance';
  }

  return new Intl.DateTimeFormat(
    'fr-FR',
  ).format(date);
}


async function load(
  showLoading =
    true,
) {
  if (refreshing) {
    if (showLoading) pendingRefresh = true;
    return;
  }
  if (
    (
      !showLoading
      &&
      document.visibilityState !==
      'visible'
    )
  ) {
    return;
  }

  refreshing =
    true;

  if (
    showLoading
  ) {
    loading.value =
      true;
  }

  if (showLoading && loadedAnalyticsPeriod !== period.value) analytics.value = null;
  if (showLoading) {
    analyticsLoading.value = !analytics.value;
    analyticsError.value = '';
  }

  error.value =
    '';

  try {
    const requestedPeriod = period.value;
    const [statsResult, analyticsResult] = await Promise.allSettled([
      getDashboard(requestedPeriod).then((response) => {
        stats.value = response.data;
        loading.value = false;
      }).catch((cause) => {
        loading.value = false;
        throw cause;
      }),
      getDashboardAnalytics(requestedPeriod).then((response) => {
        analytics.value = response.data;
        loadedAnalyticsPeriod = requestedPeriod;
        analyticsError.value = '';
      }).catch((cause) => {
        analyticsError.value = 'Les graphiques sont indisponibles pour le moment.';
        throw cause;
      }).finally(() => {
        analyticsLoading.value = false;
      }),
    ]);
    if (statsResult.status === 'rejected') error.value = 'Impossible de charger les chiffres du tableau de bord.';
    if (analyticsResult.status === 'rejected' && !analyticsError.value) analyticsError.value = 'Les graphiques sont indisponibles pour le moment.';
  } catch {
    error.value =
      'Impossible de charger les indicateurs du tableau de bord.';
  } finally {
    loading.value =
      false;

    refreshing =
      false;
    if (pendingRefresh) {
      pendingRefresh = false;
      void load();
    }
  }
}


function refreshWhenVisible() {
  if (
    document.visibilityState ===
    'visible'
  ) {
    void load(
      false,
    );
  }
}


watch(
  period,
  () =>
    void load(),
);


onMounted(() => {
  void load();

  window.addEventListener(
    'actions-changed',
    refreshWhenVisible,
  );

  window.addEventListener(
    'notifications-changed',
    refreshWhenVisible,
  );

  document.addEventListener(
    'visibilitychange',
    refreshWhenVisible,
  );

  refreshTimer =
    setInterval(
      refreshWhenVisible,
      30000,
    );
});


onBeforeUnmount(() => {
  if (
    refreshTimer
  ) {
    clearInterval(
      refreshTimer,
    );
  }

  window.removeEventListener(
    'actions-changed',
    refreshWhenVisible,
  );

  window.removeEventListener(
    'notifications-changed',
    refreshWhenVisible,
  );

  document.removeEventListener(
    'visibilitychange',
    refreshWhenVisible,
  );
});
</script>


<template>
  <AppLayout>

    <div class="dashboard-page">

      <PageHeader title="Tableau de bord"
        subtitle="Vue synthétique de l’activité de veille et des éléments nécessitant votre attention."
        eyebrow="Pilotage" icon="pi pi-chart-bar">
        <template #actions>
          <div class="dashboard-header-actions">
            <Tag :value="dashboardRole" severity="secondary" class="dashboard-role-badge" />

            <div class="period-select-wrap select-host">
              <Select
                append-to="self"
                v-model="period"
                :options="periods"
                option-label="label"
                option-value="value"
                class="period-select"
                aria-label="Période d'analyse"
              />
            </div>
          </div>
        </template>
      </PageHeader>


      <Message v-if="
        error
      " severity="error">
        {{ error }}
      </Message>


      <div v-if="loading" class="loading-panel">
        <AppSpinner centered label="Chargement des indicateurs…" />
      </div>


      <template v-else>

        <!-- Section Indicateurs Clés avec défilement horizontal mobile et flèche pour replier/masquer -->
        <div class="kpi-wrapper">
          <div class="kpi-header-ctrl" @click="kpisCollapsed = !kpisCollapsed">
            <div class="kpi-title-block">
              <i class="pi pi-chart-pie kpi-icon" />
              <span class="kpi-title">Indicateurs clés</span>
              <span class="kpi-badge">{{ cards.length }}</span>
            </div>
            <button
              type="button"
              class="kpi-collapse-btn"
              :aria-expanded="!kpisCollapsed"
              :title="kpisCollapsed ? 'Afficher les indicateurs' : 'Masquer les indicateurs'"
            >
              <span class="collapse-label">{{ kpisCollapsed ? 'Afficher' : 'Masquer' }}</span>
              <i :class="kpisCollapsed ? 'pi pi-chevron-down' : 'pi pi-chevron-up'" />
            </button>
          </div>

          <div v-show="!kpisCollapsed" class="metric-grid-scroll-wrap">
            <div class="metric-grid">
              <MetricCard
                v-for="card in cards"
                :key="card.key"
                :label="card.label"
                :value="card.value"
                :tone="tone(card.key)"
              />
            </div>
          </div>
        </div>

        <div v-if="analyticsLoading && !analytics" class="loading-panel">
          <AppSpinner centered label="Chargement des graphiques…" />
        </div>

        <Message v-if="analyticsError" severity="warn" :closable="false">
          {{ analyticsError }}
          <Button label="Réessayer" text size="small" @click="load()" />
        </Message>


        <TrendChart v-if="
          analytics
        " :title="analytics.timeline.title
          " :points="analytics.timeline.points
            " :series="analytics.timeline.series
                " />


        <div v-if="
          analytics
        " class="distribution-grid">
          <DistributionChart v-for="
              (
distribution,
  key
              ) in
    analytics.distributions
            " :key="key
              " :title="distribution.title
                " :items="distribution.items
                  " :variant="key ===
                  'tertiary'
                  ? 'bars'
                  : 'donut'
                  " />
        </div>


        <div v-if="
          analytics
        " class="details-grid" :class="{
          'has-actions':
            analytics
              .dueActions
              .length,
        }">

          <section class="detail-card">

            <h3>
              <i class="pi pi-database" />

              {{ topSourcesTitle }}
            </h3>


            <ol v-if="
              analytics
                .topSources
                .length
            ">
              <li v-for="
                  (
source,
  index
                  ) in
    analytics
      .topSources
                " :key="source.label
                  ">
                <span class="rank">
                  {{ index + 1 }}
                </span>

                <span class="item-name">
                  {{ source.label }}
                </span>

                <strong>
                  {{ source.value }}
                </strong>
              </li>
            </ol>

            <p v-else>
              Aucune source disponible.
            </p>

          </section>


          <section v-if="
            analytics
              .urgentItems
              .length
          " class="detail-card urgent-card">

            <h3>
              <i class="pi pi-exclamation-triangle" />

              Veilles importantes récentes
            </h3>


            <ul>
              <li
                v-for="urgent in analytics.urgentItems"
                :key="urgent.id"
                class="clickable-item"
                title="Cliquer pour consulter cette veille"
                @click="openWatchItem(urgent.id)"
              >
                <div>
                  <strong class="item-interactive-title">
                    {{ stripHtmlTags(urgent.title) }}
                  </strong>

                  <small>
                    {{ urgent.sourceName }}
                  </small>
                </div>

                <Tag :value="readable(
                  urgent.criticality,
                )
                  " severity="danger" />
              </li>
            </ul>

          </section>


          <section v-if="
            analytics
              .dueActions
              .length
          " class="detail-card actions-card">

            <h3>
              <i class="pi pi-clock" />

              Actions à suivre
            </h3>


            <ul>
              <li
                v-for="action in analytics.dueActions"
                :key="action.id"
                class="clickable-item"
                title="Cliquer pour consulter la veille associée"
                @click="openActionWatchItem(action)"
              >
                <div>
                  <strong class="item-interactive-title">
                    {{ action.title }}
                  </strong>

                  <small>
                    {{ stripHtmlTags(action.watchItemTitle) }}
                  </small>
                </div>

                <span class="due-date">
                  {{
                    formatDate(
                      action.dueDate,
                    )
                  }}
                </span>
              </li>
            </ul>

          </section>

        </div>

      </template>

    </div>

  </AppLayout>
</template>


<style scoped>
.dashboard-page {
  display: grid;
  gap: 1rem;
}

.loading-panel,
.detail-card {
  border:
    1px solid var(--app-border);

  border-radius:
    var(--app-radius);

  background:
    var(--app-surface);

  box-shadow:
    var(--app-shadow-soft);
}

.loading-panel {
  min-height:
    4.5rem;
}

.dashboard-header-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.period-select-wrap {
  min-width: 12rem;
  position: relative;
}

.period-select-wrap.select-host {
  width: auto;
}

.kpi-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius);
  padding: 0.85rem 1rem;
  box-shadow: var(--app-shadow-soft);
}

.kpi-header-ctrl {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  padding: 0.15rem 0;
}

.kpi-title-block {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.kpi-icon {
  color: var(--app-primary);
  font-size: 1.05rem;
}

.kpi-title {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--app-text);
}

.kpi-badge {
  font-size: 0.7rem;
  font-weight: 700;
  background: rgba(16, 185, 129, 0.15);
  color: var(--app-primary);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  border: 1px solid rgba(16, 185, 129, 0.25);
}

.kpi-collapse-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: var(--app-surface-2);
  border: 1px solid var(--app-border);
  border-radius: 0.5rem;
  padding: 0.3rem 0.65rem;
  color: var(--app-text-muted);
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.kpi-collapse-btn:hover {
  background: var(--app-surface-3);
  color: var(--app-text);
}

.metric-grid-scroll-wrap {
  width: 100%;
}

.period-select {
  width: 12rem;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem;
}

.distribution-grid {
  display: grid;

  grid-template-columns:
    repeat(3,
      minmax(0,
        1fr));

  gap:
    0.8rem;
}

.details-grid {
  display: grid;

  grid-template-columns:
    minmax(16rem,
      2fr) minmax(22rem,
      3fr);

  align-items:
    start;

  gap:
    0.8rem;
}

.details-grid.has-actions {
  grid-template-columns:
    repeat(3,
      minmax(0,
        1fr));
}

.detail-card {
  min-width:
    0;

  padding:
    0.95rem;
}

.detail-card h3 {
  display:
    flex;

  align-items:
    center;

  gap:
    0.5rem;

  margin:
    0 0 0.7rem;

  color:
    var(--app-text);

  font-size:
    0.88rem;
}

.detail-card h3 i {
  color:
    var(--app-primary);
}

.urgent-card h3 i {
  color:
    var(--app-danger);
}

.actions-card h3 i {
  color:
    var(--app-warning);
}

.detail-card ol,
.detail-card ul {
  display:
    grid;

  gap:
    0.15rem;

  margin:
    0;

  padding:
    0;

  list-style:
    none;
}

.detail-card li {
  display:
    flex;

  align-items:
    center;

  justify-content:
    space-between;

  gap:
    0.7rem;

  padding:
    0.55rem 0;

  border-bottom:
    1px solid var(--app-border);

  color:
    var(--app-text-secondary);

  font-size:
    0.74rem;
}

.detail-card li:last-child {
  border-bottom:
    0;
}

.detail-card li>div {
  min-width:
    0;
}

.detail-card li strong {
  display:
    block;

  color:
    var(--app-text);

  overflow-wrap:
    anywhere;
}

.detail-card li small {
  display:
    block;

  margin-top:
    0.15rem;

  color:
    var(--app-text-muted);
}

.rank {
  display:
    grid;

  width:
    1.4rem;

  height:
    1.4rem;

  flex:
    0 0 1.4rem;

  place-items:
    center;

  border-radius:
    999px;

  background:
    var(--app-surface-strong);

  color:
    var(--app-primary);

  font-size:
    0.64rem;

  font-weight:
    800;
}

.item-name {
  flex:
    1;

  min-width:
    0;
}

.due-date {
  flex:
    none;

  color:
    var(--app-warning);

  font-weight:
    650;
}

.clickable-item {
  cursor: pointer;
  transition: background-color 0.15s ease, transform 0.1s ease;
  padding: 0.55rem 0.5rem;
  border-radius: var(--app-radius-sm, 6px);
}

.clickable-item:hover {
  background-color: var(--app-surface-hover, rgba(255, 255, 255, 0.05));
  transform: translateX(2px);
}

.clickable-item:hover .item-interactive-title {
  color: var(--app-primary, #10b981);
}

@media (max-width: 1100px) {

  .distribution-grid,
  .details-grid,
  .details-grid.has-actions {
    grid-template-columns:
      repeat(2,
        minmax(0,
          1fr));
  }
}

@media (max-width: 850px) {
  .dashboard-header-actions {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 0.5rem;
  }

  .dashboard-role-badge {
    flex-shrink: 0;
  }

  .period-select-wrap {
    flex: 1;
    min-width: 0;
  }

  .period-select {
    width: 100% !important;
  }

  .metric-grid-scroll-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 0.4rem;
    scrollbar-width: none;
  }

  .metric-grid-scroll-wrap::-webkit-scrollbar {
    display: none;
  }

  .metric-grid {
    display: flex !important;
    flex-wrap: nowrap !important;
    gap: 0.75rem;
    width: max-content;
    scroll-snap-type: x mandatory;
  }

  .metric-grid > * {
    flex: 0 0 13rem !important;
    min-width: 13rem !important;
    scroll-snap-align: start;
  }

  .distribution-grid,
  .details-grid,
  .details-grid.has-actions {
    grid-template-columns: 1fr;
    gap: 0.85rem;
  }

  .detail-card {
    padding: 0.85rem;
  }
}
</style>

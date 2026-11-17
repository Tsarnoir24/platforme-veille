<script setup lang="ts">
import {
    computed,
    onMounted,
    ref,
} from 'vue';

import {
    useRouter,
} from 'vue-router';

import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import Textarea from 'primevue/textarea';
import Tag from 'primevue/tag';
import Select from 'primevue/select';

import {
    useToast,
} from 'primevue/usetoast';

import AppLayout from '../layouts/AppLayout.vue';
import PageHeader from '../components/ui/PageHeader.vue';
import SectionCard from '../components/ui/SectionCard.vue';
import { useTableUrlPagination } from '../composables/useTableUrlPagination';

import {
    getAllActions,
    updateAction,
    uploadActionAttachment,
    getActionAttachmentUrl,
    type FollowUpAction,
} from '../services/actions.service';

import {
    labelFr,
} from '../i18n/labels';

import {
    useAuthStore,
} from '../stores/auth';

import {
    actionError,
    actionSuccess,
} from '../utils/action-toast';

import {
    statusSeverity,
} from '../utils/status-severity';
import { stripHtmlTags } from '../utils/clean-text';

const router = useRouter();
const actions = ref<FollowUpAction[]>([]);
const loading = ref(false);
const auth = useAuthStore();
const toast = useToast();

const { firstRow, rowsPerPage, onPageChange } = useTableUrlPagination('page', 10, 'limit');

// Dialogue de clôture
const finishDialog = ref(false);
const finishingAction = ref<FollowUpAction | null>(null);
const finishProgressComment = ref('');
const finishResult = ref('');
const finishAttachmentFile = ref<File | null>(null);

// Dialogue des détails
const detailDialog = ref(false);
const detailAction = ref<FollowUpAction | null>(null);

// Dialogue d'évaluation de l'efficacité (ISO/IEC 17025)
const evalDialog = ref(false);
const evalAction = ref<FollowUpAction | null>(null);
const evalRating = ref<'EFFICACE' | 'PARTIELLEMENT_EFFICACE' | 'NON_EFFICACE'>('EFFICACE');
const evalComment = ref('');
const evalSubmitting = ref(false);

const effectivenessOptions = [
    { label: 'Efficace (Objectifs atteints, risque maîtrisé)', value: 'EFFICACE' },
    { label: 'Partiellement efficace (Actions complémentaires requises)', value: 'PARTIELLEMENT_EFFICACE' },
    { label: 'Non efficace (Nouvel écart ou réévaluation requise)', value: 'NON_EFFICACE' },
];

function openFinishDialog(action: FollowUpAction) {
    finishingAction.value = action;
    finishProgressComment.value = action.progressComment ?? '';
    finishResult.value = action.result ?? '';
    finishAttachmentFile.value = null;
    finishDialog.value = true;
}

function handleFinishFileChange(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
        finishAttachmentFile.value = target.files[0];
    } else {
        finishAttachmentFile.value = null;
    }
}

function openActionDetails(action: FollowUpAction) {
    detailAction.value = action;
    detailDialog.value = true;
}

function openEvalDialog(action: FollowUpAction) {
    evalAction.value = action;
    evalRating.value = (action.effectivenessEvaluation as any) || 'EFFICACE';
    evalComment.value = action.effectivenessComment || '';
    evalDialog.value = true;
}

const updating = ref<number[]>([]);

const isReferentOnly = computed(
    () =>
        auth.user?.roles.includes('REFERENT_LABORATOIRE') &&
        !auth.user?.roles.some((role) => ['ADMIN', 'RESPONSABLE_VEILLE'].includes(role)),
);

const canManageQuality = computed(
    () =>
        auth.user?.roles.some((role) => ['ADMIN', 'RESPONSABLE_VEILLE'].includes(role)),
);

const pageTitle = computed(
    () => isReferentOnly.value ? 'Mes actions de suivi' : 'Actions de suivi',
);

const openActions = computed(
    () => actions.value.filter((action) => action.status === 'OPEN').length,
);

const inProgressActions = computed(
    () => actions.value.filter((action) => action.status === 'IN_PROGRESS').length,
);

const doneActions = computed(
    () => actions.value.filter((action) => action.status === 'DONE').length,
);

function isOverdue(action: FollowUpAction) {
    if (action.status === 'DONE' || action.status === 'CANCELLED' || !action.dueDate) {
        return false;
    }
    const dueStr = String(action.dueDate).slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    return dueStr < todayStr;
}

const overdueActions = computed(
    () => actions.value.filter((action) => isOverdue(action)).length,
);

function formatDate(value: string | null | undefined) {
    if (!value) return 'Sans échéance';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sans échéance';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(date);
}

async function load() {
    loading.value = true;
    try {
        actions.value = (await getAllActions()).data;
    } finally {
        loading.value = false;
    }
}

async function updateStatus(action: FollowUpAction, status: string) {
    if (status === 'DONE') {
        openFinishDialog(action);
        return;
    }
    if (updating.value.includes(action.id)) return;
    updating.value.push(action.id);
    try {
        await updateAction(action.id, { status });
        actionSuccess(
            toast,
            status === 'DONE' ? 'Action terminée' : 'Action démarrée',
            `L’action « ${action.title} » a été mise à jour.`,
        );
        await load();
    } catch (error) {
        actionError(toast, error, 'Modification impossible', 'Le statut de l’action n’a pas pu être modifié.');
    } finally {
        updating.value = updating.value.filter((id) => id !== action.id);
    }
}

async function confirmFinishAction() {
    const action = finishingAction.value;
    if (!action || updating.value.includes(action.id)) return;
    updating.value.push(action.id);
    try {
        await updateAction(action.id, {
            status: 'DONE',
            progressComment: finishProgressComment.value,
            result: finishResult.value,
        });

        if (finishAttachmentFile.value) {
            await uploadActionAttachment(action.id, finishAttachmentFile.value);
        }

        finishDialog.value = false;
        actionSuccess(toast, 'Action terminée', `L’action « ${action.title} » a été clôturée avec succès.`);
        await load();
    } catch (error) {
        actionError(toast, error, 'Clôture impossible', 'Les informations de clôture n’ont pas pu être enregistrées.');
    } finally {
        updating.value = updating.value.filter((id) => id !== action.id);
    }
}

async function submitEffectiveness() {
    if (!evalAction.value) return;
    evalSubmitting.value = true;
    try {
        await updateAction(evalAction.value.id, {
            effectivenessEvaluation: evalRating.value,
            effectivenessComment: evalComment.value,
        });
        actionSuccess(toast, 'Évaluation enregistrée', 'L’évaluation de l’efficacité a été enregistrée avec succès.');
        evalDialog.value = false;
        await load();
    } catch (error) {
        actionError(toast, error, 'Erreur', 'Impossible d’enregistrer l’évaluation qualité.');
    } finally {
        evalSubmitting.value = false;
    }
}

function ownerName(action: FollowUpAction) {
    return (
        `${action.owner?.firstName ?? ''} ${action.owner?.lastName ?? ''}`.trim() ||
        action.owner?.email ||
        'Non renseigné'
    );
}

// Filtre et recherche
const searchQuery = ref('');
const statusFilter = ref<'ALL' | 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'OVERDUE'>('ALL');

function setStatusFilter(filter: 'ALL' | 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'OVERDUE') {
    statusFilter.value = statusFilter.value === filter ? 'ALL' : filter;
}

const filteredActions = computed(() => {
    let result = actions.value;

    if (statusFilter.value === 'OPEN') {
        result = result.filter((a) => a.status === 'OPEN');
    } else if (statusFilter.value === 'IN_PROGRESS') {
        result = result.filter((a) => a.status === 'IN_PROGRESS');
    } else if (statusFilter.value === 'DONE') {
        result = result.filter((a) => a.status === 'DONE');
    } else if (statusFilter.value === 'OVERDUE') {
        result = result.filter((a) => isOverdue(a));
    }

    const q = searchQuery.value.trim().toLowerCase();
    if (!q) return result;

    return result.filter((action) => {
        const title = (action.title || '').toLowerCase();
        const watchTitle = (action.watchItem?.title || '').toLowerCase();
        const actionType = labelFr(action.actionType).toLowerCase();
        const owner = ownerName(action).toLowerCase();
        const status = labelFr(action.status).toLowerCase();
        const comment = (action.progressComment || '').toLowerCase();
        const res = (action.result || '').toLowerCase();
        const attach = (action.attachmentName || '').toLowerCase();
        return (
            title.includes(q) ||
            watchTitle.includes(q) ||
            actionType.includes(q) ||
            owner.includes(q) ||
            status.includes(q) ||
            comment.includes(q) ||
            res.includes(q) ||
            attach.includes(q)
        );
    });
});

// Exportation Plan d'Actions CSV / Excel
function exportPlanActionsCSV() {
    if (!filteredActions.value.length) {
        toast.add({ severity: 'warn', summary: 'Export impossible', detail: 'Aucune action à exporter.', life: 3000 });
        return;
    }
    const headers = [
        'ID',
        'Titre Action',
        'Veille Source',
        'Type d Action',
        'Responsable',
        'Date d Echeance',
        'Statut',
        'En Retard',
        'Date Cloture',
        'Resultat / Preuve',
        'Justificatif Joint',
        'Efficacite ISO',
    ];
    const rows = filteredActions.value.map((a) => [
        a.id,
        `"${(a.title || '').replace(/"/g, '""')}"`,
        `"${stripHtmlTags(a.watchItem?.title || '').replace(/"/g, '""')}"`,
        `"${labelFr(a.actionType)}"`,
        `"${ownerName(a).replace(/"/g, '""')}"`,
        a.dueDate || '',
        labelFr(a.status),
        isOverdue(a) ? 'OUI' : 'NON',
        a.completedAt ? a.completedAt.slice(0, 10) : '',
        `"${(a.result || a.progressComment || '').replace(/"/g, '""')}"`,
        a.attachmentName || '',
        a.effectivenessEvaluation || 'NON_EVALUEE',
    ]);
    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Plan_Actions_Veille_ENVAL_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.add({ severity: 'success', summary: 'Export réussi', detail: 'Le plan d’actions a été téléchargé avec succès (format CSV compatible Excel).', life: 3500 });
}

onMounted(load);
</script>

<template>
    <AppLayout>
        <div class="actions-page">
            <PageHeader
                :title="pageTitle"
                subtitle="Pilotage et traçabilité des actions correctives et préventives issues de la veille normative, réglementaire et scientifique."
                eyebrow="Système Qualité & Suivi"
                icon="pi pi-check-square"
            >
                <template #actions>
                    <Button
                        label="Exporter le plan d'actions (Excel/CSV)"
                        icon="pi pi-download"
                        severity="secondary"
                        size="small"
                        class="export-btn"
                        @click="exportPlanActionsCSV"
                    />
                </template>
            </PageHeader>

            <!-- Cartes statistiques interactives (cliquables pour filtrer) -->
            <div class="action-stats">
                <div
                    class="stat-item clickable-stat"
                    :class="{ active: statusFilter === 'OPEN' }"
                    title="Cliquer pour afficher les actions à démarrer"
                    @click="setStatusFilter('OPEN')"
                >
                    <span class="stat-icon open"><i class="pi pi-clock" /></span>
                    <div>
                        <strong>{{ openActions }}</strong>
                        <span>À démarrer</span>
                    </div>
                </div>

                <div
                    class="stat-item clickable-stat"
                    :class="{ active: statusFilter === 'IN_PROGRESS' }"
                    title="Cliquer pour afficher les actions en cours"
                    @click="setStatusFilter('IN_PROGRESS')"
                >
                    <span class="stat-icon progress"><i class="pi pi-spinner" /></span>
                    <div>
                        <strong>{{ inProgressActions }}</strong>
                        <span>En cours</span>
                    </div>
                </div>

                <div
                    class="stat-item clickable-stat"
                    :class="{ active: statusFilter === 'DONE' }"
                    title="Cliquer pour afficher les actions terminées"
                    @click="setStatusFilter('DONE')"
                >
                    <span class="stat-icon done"><i class="pi pi-check" /></span>
                    <div>
                        <strong>{{ doneActions }}</strong>
                        <span>Terminées</span>
                    </div>
                </div>

                <div
                    class="stat-item clickable-stat overdue-stat"
                    :class="{ active: statusFilter === 'OVERDUE' }"
                    title="Cliquer pour filtrer uniquement les actions en retard"
                    @click="setStatusFilter('OVERDUE')"
                >
                    <span class="stat-icon overdue"><i class="pi pi-exclamation-triangle" /></span>
                    <div>
                        <strong>{{ overdueActions }}</strong>
                        <span>En retard</span>
                    </div>
                </div>
            </div>

            <!-- Aide & Explications fonctionnelles -->
            <div class="actions-guide-banner">
                <i class="pi pi-info-circle banner-icon" />
                <div class="banner-content">
                    <h4>Traçabilité et Exigence Qualité (ISO/IEC 17025)</h4>
                    <p>
                        Une action de suivi permet de traduire une évolution réglementaire ou normative en mesure concrète : 
                        <strong>analyse d'impact</strong>, <strong>mise à jour documentaire</strong>, <strong>vérification métrologique</strong> ou <strong>formation</strong>.
                        Vous pouvez joindre des justificatifs (certificats, fiches d'émargement) et évaluer l'efficacité de l'action a posteriori.
                    </p>
                </div>
            </div>

            <SectionCard
                :title="`${filteredActions.length} action${filteredActions.length > 1 ? 's' : ''}`"
                subtitle="Liste des actions de suivi associées aux éléments de veille."
                icon="pi pi-list"
            >
                <div class="actions-search-toolbar">
                    <div class="search-box">
                        <i class="pi pi-search search-icon" />
                        <InputText
                            v-model="searchQuery"
                            placeholder="Rechercher par action, veille, responsable, justificatif..."
                            class="search-input"
                        />
                        <Button
                            v-if="searchQuery"
                            icon="pi pi-times"
                            text
                            rounded
                            size="small"
                            class="clear-search-btn"
                            aria-label="Effacer la recherche"
                            @click="searchQuery = ''"
                        />
                    </div>
                    <div v-if="statusFilter !== 'ALL'" class="active-filter-badge">
                        <span>Filtre : <strong>{{ statusFilter === 'OVERDUE' ? 'En retard' : labelFr(statusFilter) }}</strong></span>
                        <Button icon="pi pi-times" text rounded size="small" @click="statusFilter = 'ALL'" />
                    </div>
                </div>

                <DataTable
                    :value="filteredActions"
                    :loading="loading"
                    paginator
                    :first="firstRow"
                    :rows="rowsPerPage"
                    :rows-per-page-options="[10, 20, 50]"
                    @page="onPageChange"
                >
                    <template #empty>
                        Aucune action ne correspond aux critères sélectionnés.
                    </template>

                    <Column field="title" header="Action à réaliser" sortable style="min-width: 14rem">
                        <template #body="{ data }">
                            <strong class="action-title">{{ data.title }}</strong>
                            <div v-if="data.attachmentName" class="attachment-badge-pill" title="Preuve documentaire jointe">
                                <i class="pi pi-paperclip" />
                                <span>{{ data.attachmentName }}</span>
                            </div>
                        </template>
                    </Column>

                    <Column header="Veille liée" sortable :sortField="(data: any) => data.watchItem?.title || ''" style="min-width: 14rem">
                        <template #body="{ data }">
                            <button
                                type="button"
                                class="watch-link"
                                title="Consulter la veille source"
                                @click="router.push(`/watch-items/${data.watchItem.id}`)"
                            >
                                {{ stripHtmlTags(data.watchItem?.title) }}
                            </button>
                        </template>
                    </Column>

                    <Column header="Type" sortable :sortField="(data: any) => labelFr(data.actionType)">
                        <template #body="{ data }">
                            {{ labelFr(data.actionType) }}
                        </template>
                    </Column>

                    <Column header="Responsable" sortable :sortField="(data: any) => ownerName(data)">
                        <template #body="{ data }">
                            {{ ownerName(data) }}
                        </template>
                    </Column>

                    <Column field="dueDate" header="Échéance" sortable style="width: 11rem">
                        <template #body="{ data }">
                            <div class="due-date-cell">
                                <span class="date-text" :class="{ 'overdue-date': isOverdue(data) }">
                                    {{ formatDate(data.dueDate) }}
                                </span>
                                <Tag v-if="isOverdue(data)" value="En retard" severity="danger" />
                            </div>
                        </template>
                    </Column>

                    <Column header="Statut" sortable :sortField="(data: any) => labelFr(data.status)" style="width: 8rem">
                        <template #body="{ data }">
                            <Tag :value="labelFr(data.status)" :severity="statusSeverity(data.status)" />
                        </template>
                    </Column>

                    <Column header="Détails & Preuves" style="min-width: 17rem">
                        <template #body="{ data }">
                            <div class="action-follow-up">
                                <span v-if="data.progressComment"><strong>Avancement :</strong> {{ data.progressComment }}</span>
                                <span v-if="data.result"><strong>Résultat :</strong> {{ data.result }}</span>
                                <div v-if="data.attachmentName" class="attachment-row">
                                    <i class="pi pi-file-pdf" />
                                    <a :href="getActionAttachmentUrl(data.id)" target="_blank" class="download-link">
                                        {{ data.attachmentName }}
                                    </a>
                                </div>
                                <div v-if="data.effectivenessEvaluation" class="eval-tag-row">
                                    <Tag
                                        :value="`Efficacité : ${data.effectivenessEvaluation === 'EFFICACE' ? 'Efficace' : data.effectivenessEvaluation === 'PARTIELLEMENT_EFFICACE' ? 'Partielle' : 'Non efficace'}`"
                                        :severity="data.effectivenessEvaluation === 'EFFICACE' ? 'success' : data.effectivenessEvaluation === 'PARTIELLEMENT_EFFICACE' ? 'warn' : 'danger'"
                                    />
                                </div>
                            </div>
                            <div class="table-row-btns">
                                <Button
                                    label="Détails"
                                    icon="pi pi-eye"
                                    text
                                    size="small"
                                    class="details-button"
                                    @click="openActionDetails(data)"
                                />
                                <Button
                                    v-if="data.status === 'DONE' && canManageQuality"
                                    label="Évaluer efficacité"
                                    icon="pi pi-verified"
                                    text
                                    size="small"
                                    severity="info"
                                    class="eval-button"
                                    @click="openEvalDialog(data)"
                                />
                            </div>
                        </template>
                    </Column>

                    <Column header="Action" style="width: 9rem">
                        <template #body="{ data }">
                            <Button
                                v-if="data.status === 'OPEN'"
                                label="Démarrer"
                                size="small"
                                :loading="updating.includes(data.id)"
                                @click="updateStatus(data, 'IN_PROGRESS')"
                            />
                            <Button
                                v-else-if="data.status === 'IN_PROGRESS'"
                                label="Terminer"
                                size="small"
                                severity="success"
                                :loading="updating.includes(data.id)"
                                @click="updateStatus(data, 'DONE')"
                            />
                            <span v-else class="completed-text">
                                <i class="pi pi-check-circle" /> Terminée
                            </span>
                        </template>
                    </Column>
                </DataTable>
            </SectionCard>
        </div>

        <!-- Dialogue de Clôture avec Preuve Facultative -->
        <Dialog v-model:visible="finishDialog" modal header="Clôturer l’action de suivi" class="w-full max-w-xl">
            <p v-if="finishingAction" class="finish-dialog-desc">
                Renseignez le résultat obtenu pour <strong>« {{ finishingAction.title }} »</strong>.
            </p>
            <div class="finish-fields">
                <div>
                    <label>Commentaire d’avancement / Travaux réalisés</label>
                    <Textarea
                        v-model="finishProgressComment"
                        rows="3"
                        class="w-full"
                        placeholder="Ex : Réunion réalisée avec les techniciens, mode opératoire actualisé..."
                    />
                </div>
                <div>
                    <label>Résultat ou conclusion finale</label>
                    <Textarea
                        v-model="finishResult"
                        rows="3"
                        class="w-full"
                        placeholder="Ex : Procédure validée en version 3.2, méthode opérationnelle..."
                    />
                </div>
                <div class="attachment-upload-box">
                    <label>
                        <i class="pi pi-paperclip" /> Preuve documentaire / Justificatif 
                        <span class="optional-tag">(Facultatif - Recommandé ISO 17025)</span>
                    </label>
                    <p class="attachment-hint">
                        Joignez un certificat d'étalonnage, une feuille d'émargement de formation ou un rapport d'essai.
                    </p>
                    <input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"
                        class="file-input"
                        @change="handleFinishFileChange"
                    />
                    <small v-if="finishAttachmentFile" class="selected-file-info">
                        Fichier sélectionné : <strong>{{ finishAttachmentFile.name }}</strong> ({{ Math.round(finishAttachmentFile.size / 1024) }} Ko)
                    </small>
                </div>
            </div>
            <template #footer>
                <Button label="Annuler" severity="secondary" text @click="finishDialog = false" />
                <Button
                    label="Valider et clôturer l'action"
                    icon="pi pi-check"
                    severity="success"
                    :loading="finishingAction ? updating.includes(finishingAction.id) : false"
                    @click="confirmFinishAction"
                />
            </template>
        </Dialog>

        <!-- Dialogue d'Évaluation de l'Efficacité Qualité -->
        <Dialog v-model:visible="evalDialog" modal header="Évaluation de l'efficacité de l'action (ISO/IEC 17025)" class="w-full max-w-xl">
            <div v-if="evalAction" class="eval-dialog-body">
                <p>
                    Action : <strong>{{ evalAction.title }}</strong><br />
                    Veille source : <em>{{ stripHtmlTags(evalAction.watchItem?.title) }}</em>
                </p>
                <div class="form-group select-host">
                    <label>Niveau d'efficacité</label>
                    <Select
                        append-to="self"
                        v-model="evalRating"
                        :options="effectivenessOptions"
                        option-label="label"
                        option-value="value"
                        class="w-full"
                    />
                </div>
                <div class="form-group">
                    <label>Commentaire d'évaluation / Justification qualité</label>
                    <Textarea
                        v-model="evalComment"
                        rows="3"
                        class="w-full"
                        placeholder="Ex : Les audits internes confirment la conformité des essais, aucun écart constaté..."
                    />
                </div>
            </div>
            <template #footer>
                <Button label="Annuler" severity="secondary" text @click="evalDialog = false" />
                <Button
                    label="Enregistrer l'évaluation"
                    icon="pi pi-save"
                    severity="success"
                    :loading="evalSubmitting"
                    @click="submitEffectiveness"
                />
            </template>
        </Dialog>

        <!-- Dialogue Détails de l'action -->
        <Dialog v-model:visible="detailDialog" modal header="Fiche complète de l'action" class="w-full max-w-xl">
            <div v-if="detailAction" class="action-detail-dialog">
                <h3>{{ detailAction.title }}</h3>
                <p v-if="detailAction.watchItem">
                    <strong>Veille liée :</strong> {{ stripHtmlTags(detailAction.watchItem.title) }}
                </p>
                <div class="detail-status">
                    <strong>Statut :</strong>
                    <Tag :value="labelFr(detailAction.status)" :severity="statusSeverity(detailAction.status)" />
                    <Tag v-if="isOverdue(detailAction)" value="En retard" severity="danger" />
                </div>
                <dl class="detail-grid">
                    <div><dt>Type d'action</dt><dd>{{ labelFr(detailAction.actionType) }}</dd></div>
                    <div><dt>Responsable</dt><dd>{{ ownerName(detailAction) }}</dd></div>
                    <div><dt>Date d'échéance</dt><dd>{{ formatDate(detailAction.dueDate) }}</dd></div>
                    <div><dt>Date de début</dt><dd>{{ formatDate(detailAction.startedAt) }}</dd></div>
                    <div><dt>Date de clôture</dt><dd>{{ formatDate(detailAction.completedAt) }}</dd></div>
                </dl>
                <div v-if="detailAction.progressComment" class="detail-block">
                    <strong>Commentaire d’avancement</strong>
                    <p>{{ detailAction.progressComment }}</p>
                </div>
                <div v-if="detailAction.result" class="detail-block">
                    <strong>Résultat / Conclusion</strong>
                    <p>{{ detailAction.result }}</p>
                </div>
                <div v-if="detailAction.attachmentName" class="detail-block attachment-block">
                    <strong>Preuve documentaire jointe</strong>
                    <div class="attachment-file-view">
                        <i class="pi pi-file-pdf" />
                        <a :href="getActionAttachmentUrl(detailAction.id)" target="_blank">
                            Télécharger : {{ detailAction.attachmentName }} ({{ Math.round((detailAction.attachmentSize || 0) / 1024) }} Ko)
                        </a>
                    </div>
                </div>
                <div v-if="detailAction.effectivenessEvaluation" class="detail-block eval-block">
                    <strong>Évaluation de l'efficacité (Revue Qualité)</strong>
                    <p>
                        Résultat : <strong>{{ detailAction.effectivenessEvaluation }}</strong> 
                        ({{ formatDate(detailAction.effectivenessDate) }})
                    </p>
                    <p v-if="detailAction.effectivenessComment">{{ detailAction.effectivenessComment }}</p>
                </div>
            </div>
        </Dialog>
    </AppLayout>
</template>

<style scoped>
.actions-page {
    display: grid;
    gap: 1rem;
}

.action-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.75rem;
}

.stat-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--app-border);
    border-radius: 0.85rem;
    background: var(--app-surface);
    transition: transform 0.15s ease, border-color 0.15s ease;
}

.clickable-stat {
    cursor: pointer;
}

.clickable-stat:hover {
    transform: translateY(-2px);
    border-color: var(--app-primary);
}

.clickable-stat.active {
    border-color: var(--app-primary);
    box-shadow: 0 0 0 2px rgb(16 185 129 / 0.25);
}

.overdue-stat.active {
    border-color: var(--app-danger);
    box-shadow: 0 0 0 2px rgb(239 68 68 / 0.25);
}

.stat-icon {
    display: grid;
    width: 2.3rem;
    height: 2.3rem;
    place-items: center;
    border-radius: 0.65rem;
    font-size: 1.1rem;
}

.stat-icon.open { background: rgb(245 158 11 / 0.12); color: var(--app-warning); }
.stat-icon.progress { background: rgb(59 130 246 / 0.12); color: var(--app-blue); }
.stat-icon.done { background: rgb(16 185 129 / 0.12); color: var(--app-primary); }
.stat-icon.overdue { background: rgb(239 68 68 / 0.14); color: var(--app-danger); }

.stat-item strong { display: block; color: var(--app-text); font-size: 1.25rem; }
.stat-item span:not(.stat-icon) { color: var(--app-text-muted); font-size: 0.75rem; }

.actions-guide-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.85rem;
    padding: 0.85rem 1rem;
    background: color-mix(in srgb, var(--app-blue) 10%, var(--app-surface));
    border: 1px solid color-mix(in srgb, var(--app-blue) 30%, transparent);
    border-radius: 0.85rem;
}

.banner-icon {
    color: var(--app-blue);
    font-size: 1.3rem;
    margin-top: 0.15rem;
}

.banner-content h4 {
    margin: 0 0 0.25rem 0;
    color: var(--app-text);
    font-size: 0.88rem;
    font-weight: 700;
}

.banner-content p {
    margin: 0;
    color: var(--app-text-secondary);
    font-size: 0.8rem;
    line-height: 1.45;
}

.actions-search-toolbar {
    margin-bottom: 0.9rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.search-box {
    position: relative;
    flex: 1;
}

.search-icon {
    position: absolute;
    left: 0.85rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--app-text-muted);
    font-size: 0.85rem;
    z-index: 2;
}

.search-input {
    width: 100%;
    padding-left: 2.3rem !important;
    padding-right: 2.3rem !important;
}

.clear-search-btn {
    position: absolute;
    right: 0.4rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1.8rem !important;
    height: 1.8rem !important;
    color: var(--app-text-muted) !important;
}

.active-filter-badge {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.65rem;
    background: var(--app-surface-2);
    border: 1px solid var(--app-border-strong);
    border-radius: 0.6rem;
    font-size: 0.78rem;
    color: var(--app-text);
}

.action-title {
    display: block;
    color: var(--app-text);
    font-size: 0.82rem;
    line-height: 1.35;
}

.attachment-badge-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.35rem;
    padding: 0.2rem 0.45rem;
    background: rgb(59 130 246 / 0.15);
    color: var(--app-blue);
    border-radius: 0.4rem;
    font-size: 0.68rem;
    max-width: 13rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.watch-link {
    border: 0;
    background: transparent;
    color: var(--app-blue);
    font-size: 0.75rem;
    font-weight: 650;
    text-align: left;
    cursor: pointer;
    line-height: 1.35;
}

.watch-link:hover {
    color: var(--app-primary);
    text-decoration: underline;
}

.due-date-cell {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
}

.date-text {
    color: var(--app-text-secondary);
    font-size: 0.78rem;
}

.date-text.overdue-date {
    color: var(--app-danger);
    font-weight: 700;
}

.action-follow-up {
    display: grid;
    gap: 0.3rem;
    font-size: 0.78rem;
    line-height: 1.35;
}

.attachment-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--app-blue);
}

.download-link {
    color: var(--app-blue);
    text-decoration: underline;
    font-size: 0.75rem;
}

.table-row-btns {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.35rem;
}

.details-button,
.eval-button {
    padding-left: 0;
    font-size: 0.74rem;
}

.completed-text {
    color: var(--app-primary);
    font-weight: 650;
    font-size: 0.78rem;
    display: flex;
    align-items: center;
    gap: 0.35rem;
}

/* Dialogues */
.finish-fields {
    display: grid;
    gap: 1rem;
    margin-top: 0.5rem;
}

.finish-fields label {
    display: block;
    margin-bottom: 0.35rem;
    font-weight: 700;
    color: var(--app-text);
    font-size: 0.82rem;
}

.optional-tag {
    font-weight: 400;
    color: var(--app-text-muted);
    font-size: 0.74rem;
}

.attachment-upload-box {
    padding: 0.85rem;
    border: 1px dashed var(--app-border-strong);
    border-radius: 0.75rem;
    background: var(--app-surface-2);
}

.attachment-hint {
    margin: 0 0 0.6rem 0;
    color: var(--app-text-secondary);
    font-size: 0.75rem;
}

.file-input {
    display: block;
    width: 100%;
    font-size: 0.8rem;
    color: var(--app-text-secondary);
}

.selected-file-info {
    display: block;
    margin-top: 0.4rem;
    color: var(--app-primary);
}

.eval-dialog-body {
    display: grid;
    gap: 1rem;
}

.eval-dialog-body .form-group label {
    display: block;
    margin-bottom: 0.35rem;
    font-weight: 700;
    color: var(--app-text);
    font-size: 0.82rem;
}

.action-detail-dialog {
    display: grid;
    gap: 1rem;
}

.action-detail-dialog h3 {
    margin: 0;
    color: var(--app-text);
}

.detail-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    margin: 0;
}

.detail-grid dt {
    color: var(--app-text-muted);
    font-size: 0.75rem;
    font-weight: 700;
}

.detail-grid dd {
    margin: 0.15rem 0 0;
    color: var(--app-text);
    font-size: 0.82rem;
}

.detail-block {
    padding: 0.75rem;
    border: 1px solid var(--app-border);
    border-radius: 0.65rem;
    background: var(--app-surface);
}

.detail-block p {
    margin: 0.3rem 0 0;
    white-space: pre-wrap;
    font-size: 0.8rem;
    color: var(--app-text-secondary);
}

.attachment-file-view {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.35rem;
}

.attachment-file-view a {
    color: var(--app-blue);
    text-decoration: underline;
    font-size: 0.82rem;
}

@media (max-width: 900px) {
    .action-stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (max-width: 600px) {
    .action-stats {
        grid-template-columns: 1fr;
    }
}
</style>

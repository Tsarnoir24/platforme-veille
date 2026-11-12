import { ref, watch, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";

export function useTableUrlPagination(
  paramName = "page",
  defaultLimit = 10,
  limitParamName = "limit",
) {
  const route = useRoute();
  const router = useRouter();

  function parsePageFromQuery(): number {
    const raw = route.query[paramName];
    const val = typeof raw === "string" ? parseInt(raw, 10) : NaN;
    return Number.isInteger(val) && val >= 1 ? val : 1;
  }

  function parseLimitFromQuery(): number {
    const raw = route.query[limitParamName];
    const val = typeof raw === "string" ? parseInt(raw, 10) : NaN;
    return Number.isInteger(val) && val >= 1 ? val : defaultLimit;
  }

  const currentPage = ref(parsePageFromQuery());
  const rowsPerPage = ref(parseLimitFromQuery());
  const firstRow = ref((currentPage.value - 1) * rowsPerPage.value);

  // Sync state if user clicks browser back/forward buttons
  watch(
    () => [route.query[paramName], route.query[limitParamName]],
    () => {
      const p = parsePageFromQuery();
      const l = parseLimitFromQuery();
      currentPage.value = p;
      rowsPerPage.value = l;
      firstRow.value = (p - 1) * l;
    },
  );

  function onPageChange(event: { page: number; first: number; rows: number }) {
    const newPage = event.page + 1;
    currentPage.value = newPage;
    rowsPerPage.value = event.rows;
    firstRow.value = event.first;

    const newQuery = { ...route.query };
    if (newPage > 1) {
      newQuery[paramName] = String(newPage);
    } else {
      delete newQuery[paramName];
    }

    if (event.rows !== defaultLimit) {
      newQuery[limitParamName] = String(event.rows);
    } else {
      delete newQuery[limitParamName];
    }

    // Push new history state so clicking back goes to previous page!
    void router.push({ query: newQuery });
  }

  onMounted(() => {
    const p = parsePageFromQuery();
    const l = parseLimitFromQuery();
    currentPage.value = p;
    rowsPerPage.value = l;
    firstRow.value = (p - 1) * l;
  });

  return {
    currentPage,
    rowsPerPage,
    firstRow,
    onPageChange,
  };
}

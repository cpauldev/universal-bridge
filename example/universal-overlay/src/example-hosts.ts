export const EXAMPLE_PORT_RANGE_START = 4600;

export const EXAMPLE_FRAMEWORK_IDS = [
  "react",
  "react-router",
  "nextjs",
  "vue",
  "astro",
  "solid",
  "sveltekit",
  "nuxt",
  "vanilla",
  "vinext",
] as const;

export type DashboardFrameworkId = (typeof EXAMPLE_FRAMEWORK_IDS)[number];

export interface DashboardFrameworkDefinition {
  id: DashboardFrameworkId;
  label: string;
  defaultPort: number;
}

export const DASHBOARD_FRAMEWORKS: DashboardFrameworkDefinition[] = [
  { id: "react", label: "React", defaultPort: EXAMPLE_PORT_RANGE_START + 1 },
  {
    id: "react-router",
    label: "React Router",
    defaultPort: EXAMPLE_PORT_RANGE_START + 2,
  },
  { id: "nextjs", label: "Next.js", defaultPort: EXAMPLE_PORT_RANGE_START + 3 },
  { id: "vue", label: "Vue", defaultPort: EXAMPLE_PORT_RANGE_START + 4 },
  { id: "astro", label: "Astro", defaultPort: EXAMPLE_PORT_RANGE_START + 5 },
  { id: "solid", label: "Solid", defaultPort: EXAMPLE_PORT_RANGE_START + 6 },
  {
    id: "sveltekit",
    label: "SvelteKit",
    defaultPort: EXAMPLE_PORT_RANGE_START + 7,
  },
  { id: "nuxt", label: "Nuxt", defaultPort: EXAMPLE_PORT_RANGE_START + 8 },
  {
    id: "vanilla",
    label: "Vanilla",
    defaultPort: EXAMPLE_PORT_RANGE_START + 9,
  },
  { id: "vinext", label: "Vinext", defaultPort: EXAMPLE_PORT_RANGE_START + 10 },
];

export function getFrameworkDefaultPort(id: DashboardFrameworkId): number {
  const framework = DASHBOARD_FRAMEWORKS.find(
    (candidate) => candidate.id === id,
  );
  if (!framework) {
    throw new Error(`Unknown example framework id: ${id}`);
  }
  return framework.defaultPort;
}

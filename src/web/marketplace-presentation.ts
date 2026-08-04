export type MarketplaceTab = "discover" | "work" | "play" | "create" | "develop" | "categories" | "updates";

export type MarketplaceAccountState = "signed-out" | "signed-in";

export interface ProductRatingPresentation {
  score: number;
  reviewCount: number;
  distribution: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>;
}

export interface EditorialPlacement {
  eyebrow: string;
  title: string;
  body: string;
  productID?: string;
  tone: "violet" | "teal" | "coral" | "graphite";
  actionLabel: string;
}

export interface InstalledAppPresentation {
  productID: string;
  installedVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

export interface MarketplaceUpdatePresentation {
  productID: string;
  version: string;
  releaseNote: string;
  publishedLabel: string;
}

export interface ReviewExcerptPresentation {
  title: string;
  body: string;
  author: string;
}
export interface ProductScreenshotPresentation {
  id: string;
  label: string;
}


export interface ProductPresentation {
  productID: string;
  categories: readonly string[];
  rating: ProductRatingPresentation;
  reviews: readonly ReviewExcerptPresentation[];
  screenshots: readonly ProductScreenshotPresentation[];
}

export const MARKETPLACE_TABS: readonly MarketplaceTab[] = ["discover", "work", "play", "create", "develop", "categories", "updates"];

export const MARKETPLACE_CATEGORIES = ["all", "work", "play", "create", "develop"] as const;
export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number];
function screenshotSlots(prefix: string): readonly ProductScreenshotPresentation[] {
  return [1, 2, 3, 4].map((index) => ({
    id: `${prefix}-screenshot-${index}`,
    label: `Screenshot ${index}`,
  }));
}

const FOCUS_PRODUCT_ID = "product.focus-field-guide";
const WEATHER_PRODUCT_ID = "product.weather-window";

const fallbackPresentation: ProductPresentation = {
  productID: "fallback",
  categories: ["work"],
  rating: {
    score: 4.5,
    reviewCount: 24,
    distribution: { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10 },
  },
  reviews: [
    { title: "A thoughtful companion", body: "Clear metadata and a calm widget surface.", author: "Marketplace reader" },
    { title: "Easy to understand", body: "Focused on the work it helps with.", author: "Public catalog tester" },
  ],
  screenshots: screenshotSlots("fallback"),
};

export const PRODUCT_PRESENTATION: Readonly<Record<string, ProductPresentation>> = {
  [FOCUS_PRODUCT_ID]: {
    productID: FOCUS_PRODUCT_ID,
    categories: ["work", "create"],
    rating: {
      score: 4.8,
      reviewCount: 128,
      distribution: { 1: 2, 2: 4, 3: 9, 4: 30, 5: 83 },
    },
    reviews: [
      { title: "Quietly useful", body: "Keeps the next thing visible without another inbox.", author: "Marketplace reader" },
      { title: "The right amount of focus", body: "Makes empty days feel intentional.", author: "Public catalog tester" },
    ],
    screenshots: screenshotSlots("focus-field-guide"),
  },
  [WEATHER_PRODUCT_ID]: {
    productID: WEATHER_PRODUCT_ID,
    categories: ["play", "work"],
    rating: {
      score: 4.6,
      reviewCount: 94,
      distribution: { 1: 1, 2: 4, 3: 8, 4: 28, 5: 53 },
    },
    reviews: [
      { title: "A glance is enough", body: "Compact and readable between tasks.", author: "Marketplace reader" },
      { title: "Good fallback behavior", body: "Explains offline conditions without getting in the way.", author: "Public catalog tester" },
    ],
    screenshots: screenshotSlots("weather-window"),
  },
};

export const EDITORIAL_PLACEMENTS: readonly EditorialPlacement[] = [
  {
    eyebrow: "Our favourites",
    title: "Make room for what matters.",
    body: "Keep one useful intention close.",
    productID: FOCUS_PRODUCT_ID,
    tone: "violet",
    actionLabel: "Explore Focus Field Guide",
  },
  {
    eyebrow: "Apps we love",
    title: "A small forecast for the launch bar.",
    body: "A little context for the day.",
    productID: WEATHER_PRODUCT_ID,
    tone: "teal",
    actionLabel: "View Weather Window",
  },
  {
    eyebrow: "Get started",
    title: "Find your fit.",
    body: "Browse by the moment you want to make lighter.",
    tone: "coral",
    actionLabel: "Browse categories",
  },
];

export const MARKETPLACE_UPDATES: readonly MarketplaceUpdatePresentation[] = [
  { productID: FOCUS_PRODUCT_ID, version: "1.2.0", releaseNote: "Clearer empty state.", publishedLabel: "Today" },
  { productID: WEATHER_PRODUCT_ID, version: "2.0.1", releaseNote: "Better offline fallback.", publishedLabel: "Yesterday" },
  { productID: FOCUS_PRODUCT_ID, version: "1.2.0", releaseNote: "Keeps the daily note visible.", publishedLabel: "2 days ago" },
  { productID: WEATHER_PRODUCT_ID, version: "2.0.1", releaseNote: "Refines compact temperature.", publishedLabel: "3 days ago" },
  { productID: FOCUS_PRODUCT_ID, version: "1.1.0", releaseNote: "Quieter loading state.", publishedLabel: "5 days ago" },
  { productID: WEATHER_PRODUCT_ID, version: "2.0.0", releaseNote: "Simpler forecast summary.", publishedLabel: "1 week ago" },
  { productID: FOCUS_PRODUCT_ID, version: "1.0.2", releaseNote: "Improves compact layout.", publishedLabel: "2 weeks ago" },
  { productID: WEATHER_PRODUCT_ID, version: "1.9.4", releaseNote: "Clearer offline message.", publishedLabel: "3 weeks ago" },
];

export const INSTALLED_APPS: readonly InstalledAppPresentation[] = [
  { productID: FOCUS_PRODUCT_ID, installedVersion: "1.1.0", latestVersion: "1.2.0", updateAvailable: true },
  { productID: WEATHER_PRODUCT_ID, installedVersion: "2.0.0", latestVersion: "2.0.1", updateAvailable: true },
];

export function parseMarketplaceTab(value: string | null | undefined): MarketplaceTab {
  return MARKETPLACE_TABS.includes(value as MarketplaceTab) ? (value as MarketplaceTab) : "discover";
}

export function parseMarketplaceCategory(value: string | null | undefined): MarketplaceCategory {
  return MARKETPLACE_CATEGORIES.includes(value as MarketplaceCategory) ? (value as MarketplaceCategory) : "all";
}

export function productPresentation(productID: string): ProductPresentation {
  return PRODUCT_PRESENTATION[productID] ?? { ...fallbackPresentation, productID };
}

export function productCategory(productID: string): string {
  return productPresentation(productID).categories[0] ?? "work";
}

export function tabLabel(tab: MarketplaceTab): string {
  return tab === "categories" ? "Categories" : tab.charAt(0).toUpperCase() + tab.slice(1);
}

export function categoryLabel(category: MarketplaceCategory): string {
  return category === "all" ? "All" : category.charAt(0).toUpperCase() + category.slice(1);
}

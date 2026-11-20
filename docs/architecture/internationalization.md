# Internationalization (i18n) Architecture

## Overview

AgentForge's frontend implements internationalization using **react-i18next**, supporting English (en-US) and Simplified Chinese (zh-CN). The system follows a namespace-based organization where translations are grouped by feature domain.

## Architecture Decisions

### Library Choice: react-i18next

**Selected:** react-i18next (i18next + React bindings)

**Rationale:**
- Industry standard with largest community support
- Excellent TypeScript integration and type safety potential
- Flexible namespace organization aligns with feature-based architecture
- Plugin ecosystem (language detection, caching, lazy loading)
- Gradual migration support - can coexist with hardcoded strings during transition
- ~15KB gzipped - acceptable for the feature set

**Alternatives Considered:**
- react-intl (FormatJS): More opinionated, smaller community, steeper learning curve for ICU MessageFormat

### Translation Organization: Namespace-Based

Translations are organized into namespaces by domain:

```
apps/web/src/locales/
├── en-US/
│   ├── common.json          # Shared terms (buttons, actions, status)
│   ├── navigation.json      # Menu items, routes, breadcrumbs
│   └── changesets.json      # Changeset-specific terms
├── zh-CN/
│   ├── common.json
│   ├── navigation.json
│   └── changesets.json
└── index.ts                 # i18n initialization
```

**Benefits:**
- Clear ownership - translators know where to add domain-specific terms
- Code splitting - only load needed namespaces per route
- Prevents key collisions between features
- Scales well as more features are added

### Route Labels: Identifiers vs Display Text

**Design Decision:** Route labels in `routes.tsx` remain **English identifiers**, not translated directly.

**Rationale:**
- Route labels are structural identifiers used by the navigation system
- They must be stable across language changes
- Translation happens at display time in UI components (Topbar, PageHeader)
- Tests enforce consistency between routes and navigation items

**Implementation:**
```typescript
// routes.tsx - labels are identifiers (unchanged)
{ index: true, handle: routeHandle("Overview"), element: <OverviewRoute /> }

// Topbar.tsx - translation at display time
const translatedLabel = t(labelToTranslationKey(label));
```

## Configuration

### i18n Initialization (`src/locales/index.ts`)

```typescript
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

i18n
  .use(LanguageDetector)           // Auto-detect user's language
  .use(initReactI18next)           // React integration
  .init({
    resources,                      // Translation files
    fallbackLng: "en-US",          // Default language
    defaultNS: "common",            // Default namespace
    ns: ["common", "navigation", "changesets"],
    interpolation: {
      escapeValue: false,           // React already escapes
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "agentforge-language",
    },
  });
```

**Language Detection Strategy:**
1. Check localStorage for saved preference (`agentforge-language`)
2. Fall back to browser/system language
3. Fall back to English if no match

### Bootstrap

The i18n configuration is imported in `main.tsx` before React renders:

```typescript
import "./locales";  // Initializes i18n before app starts
```

## Usage Patterns

### Basic Translation

```typescript
import { useTranslation } from "react-i18next";

export function MyComponent() {
  const { t } = useTranslation();
  
  return <button>{t("common:actions.save")}</button>;
}
```

### Translation with Interpolation

```typescript
// Translation file
{
  "page": {
    "summary": "{{count}} persisted changesets"
  }
}

// Component
<p>{t("changesets:page.summary", { count: total })}</p>
```

### Accessing Different Namespaces

```typescript
// Default namespace (common)
t("actions.save")

// Explicit namespace
t("changesets:create.title")
t("navigation:routes.overview")
```

### Dynamic Status/Enum Translation

```typescript
// For dynamic keys like status enums
changesetStatuses.map(status => ({
  value: status,
  label: t(`changesets:status.${status}`)
}))
```

## Translation File Structure

### Common Namespace (`common.json`)

Shared terms used across multiple features:

```json
{
  "actions": {
    "save": "保存",
    "cancel": "取消",
    "refresh": "刷新"
  },
  "status": {
    "success": "成功",
    "loading": "加载中..."
  },
  "pagination": {
    "page": "第",
    "of": "共"
  }
}
```

### Feature Namespaces (`changesets.json`)

Domain-specific translations organized by UI section:

```json
{
  "page": {
    "title": "变更集",
    "summary": "{{count}} 个持久化变更集"
  },
  "create": {
    "title": "创建变更集",
    "successMessage": "变更集已创建并持久化。"
  },
  "list": {
    "emptyDefault": "暂无变更集。"
  },
  "status": {
    "draft": "草稿",
    "in_review": "审查中"
  }
}
```

## Language Switching

### LanguageSwitcher Component

Located in `src/shared/ui/components/LanguageSwitcher.tsx`:

```typescript
export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  
  const toggleLanguage = () => {
    const nextLanguage = i18n.language === "en-US" ? "zh-CN" : "en-US";
    i18n.changeLanguage(nextLanguage);  // Persists to localStorage
  };
  
  return <Button onClick={toggleLanguage}>/* ... */</Button>;
}
```

**Integration:** Added to `Topbar` component for global access.

**Persistence:** Language selection is automatically saved to localStorage (`agentforge-language`) and restored on page refresh.

## Testing with i18n

### Test Setup

Tests must initialize i18n before rendering components:

```typescript
import i18n from "../../locales";
import { beforeAll } from "vitest";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");  // Force English for consistent tests
});
```

**Why:** Test assertions expect specific text. Setting language explicitly ensures tests don't fail based on system locale.

### Server-Side Rendering in Tests

react-dom/server's `renderToStaticMarkup` works with i18n once initialized. No special SSR configuration needed.

### Translation Consistency Checks

A missing key does not throw: i18next renders the key path itself, so the UI would quietly show
`settings.keys.daysAgo` instead of a sentence. Two test files guard against that, and both run as
part of `npm test` and `npm run check:i18n`:

| File | What it checks |
|---|---|
| `src/architecture/i18n-keys.test.ts` | Every key the code asks for exists in every shipped language; the languages agree key by key; they agree on the `{{placeholder}}` names; every navigation label, group, description, settings entry and pipeline state resolves |
| `src/locales/locales.test.ts` | The runtime behaviour: a missing key renders a readable label rather than a key path, the document language follows the UI, plurals pick the right form |

The check reads the source, so a new `t()` call is covered as soon as it is written. A key built
at runtime is not visible to it, so such keys are listed in an exported constant that the check
resolves instead — for example `pages/pipelines/pipeline-states.ts`,
`pages/settings/settings-nav.ts` and `shared/api/errors.ts`.

**When you add a translation:** add the key to every language file in the same change. The parity
check fails the build otherwise.

### API Errors

The API answers with RFC 7807 problem details whose prose is English. That prose never reaches
the interface: `shared/api/errors.ts` maps the HTTP status to a translation key, and the pages
call `translateError(cause, t, "<namespace>:errors.<key>")`. The fallback key describes the action
that failed ("unable to load changesets") and is used when the request never reached the API.

## Migration Strategy

### Completed

- ✅ **Phase 1:** Infrastructure setup (i18n config, language switcher)
- ✅ **Phase 2:** Pilot page (ChangesetsPage fully migrated)
- ✅ **Phase 3:** Shared components (Topbar, PageHeader)

### Pattern Established

The ChangesetsPage migration demonstrates the complete pattern:
1. Create namespace translation files (`en-US/*.json`, `zh-CN/*.json`)
2. Add namespace to `locales/index.ts` resources and `ns` array
3. Import `useTranslation` in component
4. Replace hardcoded strings with `t()` calls
5. Use interpolation for dynamic values
6. Update tests to initialize i18n

### Remaining Work

Future migrations should follow the established pattern:

**High Priority:**
- The resource pages (Projects, Workspaces, Memory, Security, Governance, Usage). Their demo data
  tables carry about 500 hardcoded English strings.

**Medium Priority:**
- The delivery pages (Stacks, Self-healing) and the dev/UI showcase page.

**Low Priority:**
- The demo entity names inside the resource pages. A name like "Core Platform" reads as data
  rather than as interface copy, so it may stay as it is.

**Done:**
- The settings pages, the organization page, the changesets and repositories pages, the
  pipelines and overview pages, the delivery flow, login and register, and the app shell.

## Adding New Translations

### 1. Determine Namespace

- Shared terms (buttons, status) → `common.json`
- Navigation/routes → `navigation.json`
- Feature-specific → create new namespace file

### 2. Add Translation Keys

Create or update JSON files in both `en-US/` and `zh-CN/`:

```json
// en-US/myfeature.json
{
  "section": {
    "key": "English text"
  }
}

// zh-CN/myfeature.json
{
  "section": {
    "key": "中文文本"
  }
}
```

### 3. Register Namespace

If creating a new namespace, update `locales/index.ts`:

```typescript
import enMyFeature from "./en-US/myfeature.json";
import zhMyFeature from "./zh-CN/myfeature.json";

const resources = {
  "en-US": {
    // ...
    myfeature: enMyFeature,
  },
  "zh-CN": {
    // ...
    myfeature: zhMyFeature,
  },
};

// Add to namespace array
ns: ["common", "navigation", "changesets", "myfeature"],
```

### 4. Use in Component

```typescript
const { t } = useTranslation();
<span>{t("myfeature:section.key")}</span>
```

## Best Practices

### Key Naming

- Use descriptive, hierarchical keys: `changesets:create.titleLabel`
- Group by UI section: `page`, `create`, `list`, `errors`
- Avoid overly nested structures (max 3 levels)

### Interpolation

- Use `{{variableName}}` for dynamic values
- Keep variable names semantic: `{{count}}`, `{{organizationName}}`
- Don't concatenate translated strings - use interpolation instead

### Avoid Translation

**Don't translate:**
- API field names and technical identifiers
- Code examples and log messages
- External brand names
- Numbers and dates (use i18n formatting instead if needed)

### Translation Quality

- Keep tone consistent within each language
- Avoid literal character-by-character translation
- Consider cultural context (e.g., Chinese prefers concise phrasing)
- Test both languages visually - some translations may be longer/shorter

## Future Enhancements

### Type Safety

Add TypeScript autocomplete for translation keys:

```typescript
// locales/types.ts
type TranslationKey = 
  | 'common:actions.save'
  | 'changesets:create.title'
  | ...;

// Typed hook
const t = useTranslation<TranslationKey>();
```

### Lazy Loading

For larger applications, lazy-load namespaces per route:

```typescript
// Only load changesets translations on changesets route
i18n.loadNamespaces('changesets');
```

### Pluralization

i18next v27 uses the v4 JSON format: the plural category is a suffix on the key. English selects
`one` and `other`; Chinese selects `other` only, so it needs the same text in both.

```json
{
  "daysAgo_one": "{{count}} day ago",
  "daysAgo_other": "{{count}} days ago"
}
```

A caller passes the count as the reserved `count` option and i18next picks the form:

```typescript
t('settings:keys.daysAgo', { count: 1 })   // "1 day ago"
t('settings:keys.daysAgo', { count: 5 })   // "5 days ago"
```

The `architecture/i18n-keys.test.ts` check requires every plural key to define every category its
language can select, so a missing `_one` fails the build instead of showing the bare key.

### Date/Number Formatting

i18next has no formatter plugin in this project. Use the platform `Intl` API with the active
language instead of `toLocaleString()` without a locale, so the format follows the UI language
rather than the browser's. `shared/i18n/format.ts` wraps this:

```typescript
import { formatDate, formatDateTime, formatRelativeTime } from "../shared/i18n/format";

formatDateTime(commit.authored_at)   // "2026年11月19日 10:00" under zh-CN
formatRelativeTime(event.at)         // "3 分钟前"
```

For numbers, use `Intl.NumberFormat(i18n.resolvedLanguage)`.

## References

- [react-i18next Documentation](https://react.i18next.com/)
- [i18next Documentation](https://www.i18next.com/)
- Project ADR-008: Route Structure (route label architecture)

---

**Last Updated:** 2024-01-18  
**Maintainer:** Development Team

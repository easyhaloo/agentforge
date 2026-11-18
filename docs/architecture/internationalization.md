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
- Repositories page
- Organization settings
- Error/notification messages

**Medium Priority:**
- Overview page and dashboard widgets
- Resource pages (Projects, Workspaces, etc.)
- Delivery pages (Stacks, Self-healing)

**Low Priority:**
- Dev/UI showcase pages
- Footer text

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

Add plural forms when needed:

```json
{
  "items": "{{count}} item",
  "items_plural": "{{count}} items"
}
```

### Date/Number Formatting

Integrate i18n formatting for dates and numbers:

```typescript
t('date', { val: new Date(), formatParams: { val: { month: 'long' } } })
```

## References

- [react-i18next Documentation](https://react.i18next.com/)
- [i18next Documentation](https://www.i18next.com/)
- Project ADR-008: Route Structure (route label architecture)

---

**Last Updated:** 2024-01-18  
**Maintainer:** Development Team

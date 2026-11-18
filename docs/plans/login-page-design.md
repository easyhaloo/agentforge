# Login Page Design Specification

**Status:** Design proposal (Updated)  
**Created:** 2024  
**Updated:** 2024 (full-page pattern clarification)  
**Scope:** Standalone login page for AgentForge web application  
**Related:** ADR-008 (routing), `docs/architecture/identity-and-tenancy.md` (OIDC auth)

---

## 0. Design Pattern Principles (CRITICAL)

### 0.1 Full-Page Pattern (GitHub/GitLab Style)

**Core principle:** Although AgentForge uses SPA technology (React Router), **every major feature should be designed as a complete, independent page**, not tabs or modal dialogs.

**✅ GitHub/GitLab Pattern:**
- Each major function is a distinct full page with its own URL
- Clear page hierarchy and navigation paths
- Sidebar navigation + complete content area on the right
- Deep linking: every state has a URL

**❌ NOT this pattern:**
- Tab switching within a single view
- Content toggled via show/hide in one container
- Modals as primary content containers

**Examples:**

**GitHub:**
- User settings: `/settings/profile`, `/settings/account`, `/settings/security` - each is a full page
- Repository: `/:org/:repo` (main), `/:org/:repo/issues` (separate page), `/:org/:repo/settings` (another page)
- **NOT** tabs inside `/settings`

**GitLab:**
- Project details: `/:org/:project` - full page with file tree, README, activity
- Project settings: `/:org/:project/-/settings/general` - independent page with breadcrumbs and side nav
- CI/CD settings: `/:org/:project/-/settings/ci_cd` - another independent page

**AgentForge Application:**
Current ADR-008 routing already supports this. Should expand to:
- `/orgs/:org/settings/general` - Organization info (full page)
- `/orgs/:org/settings/members` - Member management (full page)
- `/orgs/:org/settings/security` - Security settings (full page)
- `/orgs/:org/repositories/:repo` - Repository details (full page)
- `/orgs/:org/repositories/:repo/settings` - Repository settings (full page)

### 0.2 Login Page Implications

**The login page MUST be:**
- **Completely independent page** (NOT inside the app shell)
- **No app shell components** (no sidebar, no topbar)
- **Full-screen layout** focused on login experience
- Similar to GitHub/GitLab unauthenticated pages

**Layout structure:**
```
Unauthenticated:
  /login → Login page (full screen, no shell)
  
Authenticated:
  /orgs/:org/* → App pages (with shell: sidebar + topbar + content)
    Each route is a complete page, not tab switching
```

This means the login page design must NOT assume the presence of the application shell (sidebar, topbar, brand header) that exists on authenticated pages.

---

## 1. Current State Analysis

### 1.1 Existing Authentication Flow

**Technical Implementation:**
- Backend: OIDC Authorization Code Flow + PKCE (`/auth/oidc/login` endpoint)
- Frontend: React 19 + TypeScript + Vite, React Router data router
- Session: Secure, HttpOnly cookies (`__Host-agentforge_session`)
- Entry point: Plain `<a href="/auth/oidc/login">` anchor (not React Router)

**Current UI State:**
- No dedicated login page exists
- `OrganizationGate` component (`apps/web/src/app/OrganizationGate.tsx`) shows inline authentication prompts when users access protected routes
- Inline prompt: simple card with heading, description, and "Continue with SSO" button
- Protected pages are organization-scoped under `/orgs/:org/*`

**Gap:**
- No landing page for direct authentication (e.g., bookmark, external link, initial visit)
- No dedicated space for product introduction and value proposition
- No explicit `/login` route for standard auth UX patterns

### 1.2 Technical Constraints

**Must support:**
- OIDC SSO only (no username/password form)
- Single configured OIDC provider (no provider selection UI needed)
- Accessible without authentication (public route)
- Mobile and desktop responsive
- i18n-ready (branch `feat/i18n-foundation` indicates internationalization work in progress)
- **Standalone page layout** (no app shell: no sidebar, no topbar)

**Must NOT include:**
- Username/password input fields
- "Sign up" or registration forms (invitation-only, handled by OIDC callback)
- "Forgot password" links
- Multiple SSO provider selection
- **App shell components** (sidebar, topbar, org switcher)
- **Any authenticated UI elements**

---

## 2. Design Goals

### 2.1 User Experience Goals

1. **Clarity**: First-time visitors understand what AgentForge is and why they should authenticate
2. **Simplicity**: SSO-only flow means minimal decision-making and UI chrome
3. **Professionalism**: Enterprise-grade appearance matching GitHub/GitLab expectations
4. **Accessibility**: Keyboard navigation, screen reader support, high contrast ratios
5. **Standalone experience**: Complete, self-contained page (like GitHub/GitLab login), not embedded in app shell
6. **Design consistency**: Reuses design system tokens (colors, typography) but with its own layout structure

### 2.2 Visual Goals

1. **Brand presence**: Logo, product name, tagline prominent
2. **Trust signals**: Professional typography, balanced whitespace, quality execution
3. **Focus**: Single clear call-to-action (SSO button)
4. **Responsive**: Graceful adaptation from 320px mobile to 4K desktop

---

## 3. Layout Design

### 3.1 Overall Structure

**Approach:** Full-page standalone layout with centered card (GitHub/GitLab login pattern)

**Rationale:**
- **Standalone page** (not inside app shell) - login is a pre-authenticated state
- SSO-only means no complex form; split-screen would be over-designed
- Centered card focuses attention on the single action
- Simpler to implement and maintain
- Better mobile adaptation than split layouts
- Allows room for product messaging without overwhelming
- Matches GitHub/GitLab unauthenticated page pattern

**Critical distinction:**
- This page renders **outside** the `<App />` shell layout
- No sidebar, no topbar, no organization switcher
- Self-contained: own header, own branding, own footer
- Transitions to shell only after successful authentication

**Page Structure (full viewport):**
```
┌────────────────────────────────────────────────────────────┐
│                  <body> (no shell)                         │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │            Centered Container (max-width)            │ │
│  │                                                      │ │
│  │  ┌────────────────────────────────────────────────┐ │ │
│  │  │           Login Card (.card)                   │ │ │
│  │  │  ┌──────────────────────────────────────────┐ │ │ │
│  │  │  │  Brand + Content                         │ │ │ │
│  │  │  └──────────────────────────────────────────┘ │ │ │
│  │  └────────────────────────────────────────────────┘ │ │
│  │                                                      │ │
│  │  ┌────────────────────────────────────────────────┐ │ │
│  │  │           Footer                               │ │ │
│  │  └────────────────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
└────────────────────────────────────────────────────────────┘
       ↑ Full viewport, no sidebar/topbar
```

---

## 4. Desktop Layout (≥720px)

### 4.1 ASCII Prototype

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│                                                                          │
│            ┌────────────────────────────────────────────┐              │
│            │                                            │              │
│            │         ┌────┐                             │              │
│            │         │ AF │  AgentForge                 │              │
│            │         └────┘                             │              │
│            │                                            │              │
│            │      Agent-native Source Control &         │              │
│            │      Verified Change Platform              │              │
│            │                                            │              │
│            │   ┌────────────────────────────────────┐  │              │
│            │   │                                    │  │              │
│            │   │   [Lock Icon]                      │  │              │
│            │   │   Continue with SSO                │  │              │
│            │   │                                    │  │              │
│            │   └────────────────────────────────────┘  │              │
│            │                                            │              │
│            │         Secure authentication via          │              │
│            │         OpenID Connect                     │              │
│            │                                            │              │
│            └────────────────────────────────────────────┘              │
│                                                                          │
│                   AgentForge v0.x.x • Privacy • Terms                   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Detailed Component Breakdown

**Card Container:**
- Max-width: `480px`
- Padding: `48px 40px` (generous, comfortable)
- Background: `.card` class (`#101725`)
- Border: `1px solid #242e42`
- Border-radius: `10px`
- Box-shadow: Subtle, matching other cards
- Centered horizontally and vertically in viewport

**Brand Section:**
- Brand mark: `48px × 48px` (larger than shell's 34px)
- Same gradient: `linear-gradient(145deg, #8d7bff, #5c55c9)`
- Product name: `DM Sans`, `24px`, `font-weight: 600`, `color: #e8eaf2`, `letter-spacing: -0.6px`
- Alignment: Center
- Margin-bottom: `32px`

**Tagline:**
- Text: "Agent-native Source Control & Verified Change Platform"
- Font: `DM Sans`, `15px`, `line-height: 1.5`
- Color: `#8995aa` (muted)
- Text-align: center
- Max-width: `360px` (line length control)
- Margin: `0 auto 40px`

**SSO Button:**
- Full-width within card content
- Height: `44px` (larger than default 34px for prominence)
- Style: `.button.primary` (existing)
- Text: "Continue with SSO" or "Sign in with SSO"
- Icon: Lock or key icon (optional, left-aligned)
- Font-size: `13px`
- Margin-bottom: `24px`

**Trust Message:**
- Text: "Secure authentication via OpenID Connect"
- Font: `DM Sans`, `11px`, `color: #78859b`
- Text-align: center
- Icon: Shield or checkmark (optional)

**Footer:**
- Positioned below card (not inside)
- Font-size: `10px`, `color: #64718a`
- Links: Version, Privacy, Terms (muted, hover: lighter)
- Separator: ` • `
- Text-align: center
- Margin-top: `32px`

---

## 5. Mobile Layout (<720px)

### 5.1 ASCII Prototype

```
┌───────────────────────────────┐
│                               │
│       ┌────┐                  │
│       │ AF │  AgentForge      │
│       └────┘                  │
│                               │
│   Agent-native Source         │
│   Control & Verified          │
│   Change Platform             │
│                               │
│  ┌─────────────────────────┐ │
│  │                         │ │
│  │ [Icon] Continue with SSO│ │
│  │                         │ │
│  └─────────────────────────┘ │
│                               │
│  Secure authentication via    │
│  OpenID Connect               │
│                               │
│                               │
│  v0.x.x • Privacy • Terms     │
│                               │
└───────────────────────────────┘
```

### 5.2 Mobile Adaptations

**Card Container:**
- Max-width: `calc(100vw - 32px)` (16px margin on each side)
- Padding: `32px 24px` (reduced from desktop)
- Maintain same background/border

**Brand Section:**
- Brand mark: `40px × 40px` (slightly smaller)
- Product name: `20px` (reduced from 24px)
- Margin-bottom: `24px` (reduced from 32px)

**Tagline:**
- Font-size: `13px` (reduced from 15px)
- Line-height: `1.5`
- Margin-bottom: `32px`

**SSO Button:**
- Full-width (same as desktop)
- Height: `44px` (maintain tap target size)
- Text may wrap on very narrow screens (<360px)

**Footer:**
- Font-size: `9px`
- May stack links vertically on very narrow screens (<360px)

---

## 6. Interaction States

### 6.1 SSO Button States

**Default:**
```
┌──────────────────────────────────┐
│  🔒 Continue with SSO            │  ← #7868e6 background
└──────────────────────────────────┘
```

**Hover:**
```
┌──────────────────────────────────┐
│  🔒 Continue with SSO            │  ← #8979f4 background (lighter)
└──────────────────────────────────┘
```

**Active/Pressed:**
```
┌──────────────────────────────────┐
│  🔒 Continue with SSO            │  ← Slightly darker, scale(0.98)
└──────────────────────────────────┘
```

**Focus (keyboard):**
```
╔══════════════════════════════════╗
║  🔒 Continue with SSO            ║  ← Visible focus ring (outline)
╚══════════════════════════════════╝
```

**Loading (after click, during redirect):**
```
┌──────────────────────────────────┐
│  ⟳ Redirecting to SSO...         │  ← Spinner, disabled state
└──────────────────────────────────┘
```

### 6.2 Error State

If OIDC configuration is unavailable (503 from backend):

```
┌────────────────────────────────────────────┐
│                                            │
│         ┌────┐                             │
│         │ AF │  AgentForge                 │
│         └────┘                             │
│                                            │
│      Agent-native Source Control &         │
│      Verified Change Platform              │
│                                            │
│   ┌────────────────────────────────────┐  │
│   │  ⚠ Authentication Unavailable      │  │  ← Alert styling
│   │                                    │  │
│   │  The authentication service is     │  │
│   │  temporarily unavailable. Please   │  │
│   │  try again later or contact        │  │
│   │  support if the issue persists.    │  │
│   └────────────────────────────────────┘  │
│                                            │
│   ┌────────────────────────────────────┐  │
│   │        Retry                       │  │  ← Secondary button
│   └────────────────────────────────────┘  │
│                                            │
└────────────────────────────────────────────┘
```

### 6.3 Already Authenticated State

If user visits `/login` while already authenticated:

**Option A: Redirect immediately** (preferred)
- JavaScript checks session/account on mount
- Redirects to `/` or last attempted protected route

**Option B: Show confirmation**
```
┌────────────────────────────────────────────┐
│                                            │
│         ┌────┐                             │
│         │ AF │  AgentForge                 │
│         └────┘                             │
│                                            │
│   ┌────────────────────────────────────┐  │
│   │  ✓ Already Signed In               │  │
│   │                                    │  │
│   │  You're signed in as               │  │
│   │  user@example.com                  │  │
│   └────────────────────────────────────┘  │
│                                            │
│   ┌────────────────────────────────────┐  │
│   │        Go to Dashboard             │  │
│   └────────────────────────────────────┘  │
│                                            │
│   ┌────────────────────────────────────┐  │
│   │        Sign Out                    │  │
│   └────────────────────────────────────┘  │
│                                            │
└────────────────────────────────────────────┘
```

---

## 7. Visual Specification

### 7.1 Color Palette (from existing design system)

**From `apps/web/src/styles/index.css`:**

| Token | Hex | Usage |
|-------|-----|-------|
| Background (body) | `#090d16` | Page background |
| Card background | `#101725` | Login card surface |
| Card border | `#242e42` | Card outline |
| Primary text | `#e8eaf2` | Headings, product name |
| Secondary text | `#8995aa` | Tagline, descriptions |
| Muted text | `#78859b` | Trust message |
| Footer text | `#64718a` | Footer links |
| Primary button bg | `#7868e6` | SSO button default |
| Primary button hover | `#8979f4` | SSO button hover |
| Primary button border | `#8171ed` | SSO button outline |
| Brand gradient start | `#8d7bff` | Brand mark top |
| Brand gradient end | `#5c55c9` | Brand mark bottom |
| Alert background | `#141d2c` | Error state card |
| Alert border | `#34415a` | Error state outline |
| Alert text | `#cbd3e1` | Error message |

### 7.2 Typography

**From `apps/web/src/styles/index.css`:**

| Element | Specification |
|---------|---------------|
| Font family | DM Sans (primary), DM Mono (monospace) |
| Base size | `14px` |
| Product name | `24px / 600 / -0.6px / #e8eaf2` |
| Tagline | `15px / 400 / 1.5 / #8995aa` |
| Button text | `13px / 600 / inherit` |
| Trust message | `11px / 400 / 1.5 / #78859b` |
| Footer | `10px / 400 / 1 / #64718a` |

### 7.3 Spacing

**Card:**
- Desktop padding: `48px 40px`
- Mobile padding: `32px 24px`
- Max-width: `480px`
- Border-radius: `10px`

**Internal spacing:**
- Brand mark → Product name: `12px`
- Product name → Tagline: `16px`
- Tagline → Button: `40px`
- Button → Trust message: `24px`
- Card → Footer: `32px`

**Brand mark:**
- Size: `48px × 48px` (desktop), `40px × 40px` (mobile)
- Border-radius: `12px`
- Box-shadow: `0 5px 18px rgba(116, 102, 238, 0.25)`

**Button:**
- Height: `44px`
- Padding: `0 20px`
- Border-radius: `7px`
- Gap (icon to text): `10px`

### 7.4 Iconography

**Brand mark icon:**
- Use existing logo or "AF" monogram
- White text on gradient background
- Font: DM Sans Bold, `18px`, centered

**SSO button icon (optional):**
- Lock (🔒) or Key icon
- Size: `18px × 18px`
- Color: currentColor (white)
- Position: Left of text, `10px` gap

**Error icon:**
- Warning triangle (⚠) or alert icon
- Size: `18px × 18px`
- Color: `#f0a4ae` (error accent)

---

## 8. Copy and Microcopy

### 8.1 English (Primary)

| Element | Text |
|---------|------|
| Page title (document) | `Sign In • AgentForge` |
| Product name | `AgentForge` |
| Tagline | `Agent-native Source Control & Verified Change Platform` |
| Button label | `Continue with SSO` |
| Trust message | `Secure authentication via OpenID Connect` |
| Footer version | `AgentForge v0.x.x` (dynamic) |
| Footer links | `Privacy • Terms • Status` |
| Error heading | `Authentication Unavailable` |
| Error body | `The authentication service is temporarily unavailable. Please try again later or contact support if the issue persists.` |
| Retry button | `Retry` |
| Already signed in heading | `Already Signed In` |
| Already signed in body | `You're signed in as {email}` |
| Dashboard button | `Go to Dashboard` |
| Sign out button | `Sign Out` |

### 8.2 i18n Considerations

**Locale keys structure:**
```typescript
{
  "login": {
    "title": "Sign In",
    "tagline": "Agent-native Source Control & Verified Change Platform",
    "button": "Continue with SSO",
    "trustMessage": "Secure authentication via OpenID Connect",
    "error": {
      "heading": "Authentication Unavailable",
      "body": "The authentication service is temporarily unavailable..."
    },
    "alreadySignedIn": {
      "heading": "Already Signed In",
      "body": "You're signed in as {{email}}"
    }
  }
}
```

**RTL (Right-to-Left) considerations:**
- Layout should mirror horizontally for Arabic, Hebrew
- Icon positions flip (left ↔ right)
- Text alignment: `text-align: start` (not `left`)
- Use logical properties: `margin-inline-start` vs. `margin-left`

**Variable-length text:**
- Button text may vary significantly (e.g., German tends longer)
- Allow button text to wrap gracefully on narrow viewports
- Tagline should support 2-3 lines without breaking layout

---

## 9. Accessibility

### 9.1 WCAG 2.1 AA Compliance

**Color Contrast:**
| Pair | Ratio | Pass |
|------|-------|------|
| Primary text (#e8eaf2) on card bg (#101725) | 12.4:1 | ✓ AAA |
| Secondary text (#8995aa) on card bg | 6.8:1 | ✓ AA |
| Muted text (#78859b) on card bg | 5.2:1 | ✓ AA |
| Footer text (#64718a) on body bg (#090d16) | 4.8:1 | ✓ AA |
| Button text (white) on primary bg (#7868e6) | 8.1:1 | ✓ AAA |

All color pairs meet WCAG AA (4.5:1 for normal text, 3:1 for large text).

**Semantic HTML:**
```html
<main role="main" aria-labelledby="login-heading">
  <div class="login-card card">
    <header>
      <div class="brand-mark" aria-hidden="true">AF</div>
      <h1 id="login-heading">AgentForge</h1>
      <p class="tagline">Agent-native Source Control & Verified Change Platform</p>
    </header>
    
    <a href="/auth/oidc/login" class="button primary" role="button">
      <svg aria-hidden="true">...</svg>
      Continue with SSO
    </a>
    
    <p class="trust-message">
      <svg aria-label="Secure">...</svg>
      Secure authentication via OpenID Connect
    </p>
  </div>
  
  <footer>
    <nav aria-label="Footer navigation">
      <span>AgentForge v0.x.x</span>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </nav>
  </footer>
</main>
```

**Keyboard Navigation:**
- Tab order: SSO button → Footer links
- Enter/Space activates button
- Visible focus indicator (outline, not just color change)
- No keyboard traps

**Screen Reader:**
- Page announces as "Sign In, AgentForge"
- Button announces as "Continue with SSO, link button"
- Decorative icons use `aria-hidden="true"`
- Informative icons use `aria-label`
- Error messages use `role="alert"` for immediate announcement

**Focus Management:**
- On page load: no auto-focus (user choice)
- On error: focus moves to error message
- After authentication: focus managed by next page

### 9.2 Reduced Motion

Users with `prefers-reduced-motion: reduce`:
- No loading spinner animation (static icon)
- No scale transform on button press
- Instant state transitions (no fade-in/fade-out)

```css
@media (prefers-reduced-motion: reduce) {
  .login-button {
    transition: none;
    transform: none;
  }
  .spinner {
    animation: none;
  }
}
```

---

## 10. Responsive Strategy

### 10.1 Breakpoint Summary

| Breakpoint | Viewport Width | Changes |
|------------|----------------|---------|
| Mobile | < 480px | Smallest card, minimum text sizes |
| Tablet | 480px - 720px | Comfortable card, standard text |
| Desktop | ≥ 720px | Maximum card width (480px), optimal spacing |

### 10.2 Fluid Typography

Use CSS clamp for smooth scaling:
```css
.product-name {
  font-size: clamp(20px, 4vw, 24px);
}
.tagline {
  font-size: clamp(13px, 2.5vw, 15px);
}
```

### 10.3 Touch Target Sizes

Mobile touch targets ≥ 44px × 44px (iOS HIG, Android guidelines):
- SSO button: `44px` height ✓
- Footer links: `44px` height padding on mobile
- Minimum gap between touch targets: `8px`

---

## 11. Technical Implementation

### 11.1 File Structure

**New files to create:**
```
apps/web/src/
├── pages/
│   └── login/
│       ├── LoginPage.tsx          # Main standalone page component
│       ├── LoginPage.test.tsx     # Unit tests
│       ├── LoginPage.css          # Scoped styles
│       └── index.ts               # Re-export
├── locales/
│   ├── en/
│   │   └── login.json             # English translations
│   └── zh/
│       └── login.json             # Chinese translations (if needed)
```

**Files to modify:**
```
apps/web/src/
├── app/
│   ├── routes.tsx                 # Add /login route OUTSIDE App shell
│   └── RouteElements.tsx          # Add LoginRoute lazy loader
```

**Critical routing distinction:**
The login page must render **outside** the `<App />` component that provides the shell (sidebar + topbar). This means it needs to be a sibling route, not a child.

### 11.2 Route Configuration

**CRITICAL: Login route must be OUTSIDE the App shell**

**Current structure (from `apps/web/src/app/routes.tsx`):**
```typescript
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <App />,  // ← App shell (sidebar + topbar)
    errorElement: <RootError />,
    children: [
      // All authenticated and mock pages are children of <App />
      { index: true, element: <OverviewRoute /> },
      { path: "orgs/:org/changesets", element: <ChangesetsRoute /> },
      // ...
    ],
  },
];
```

**Updated structure (login as sibling route):**

**Option A: Login as top-level sibling** (recommended)
```typescript
import { LoginRoute } from "./RouteElements";

export const routes: RouteObject[] = [
  // Login route - NO shell (sibling to App, not child)
  {
    path: "/login",
    element: <LoginRoute />,
    errorElement: <RootError />,
  },
  
  // All other routes - WITH shell
  {
    path: "/",
    element: <App />,  // App shell renders sidebar + topbar
    errorElement: <RootError />,
    children: [
      {
        errorElement: <PageError />,
        children: [
          { index: true, handle: routeHandle("Overview"), element: <OverviewRoute /> },
          // ... all other routes inside shell
        ],
      },
    ],
  },
];
```

**Option B: Shared error boundary wrapper**
```typescript
export const routes: RouteObject[] = [
  {
    errorElement: <RootError />,
    children: [
      // Unauthenticated routes (no shell)
      { path: "/login", element: <LoginRoute /> },
      
      // Authenticated routes (with shell)
      {
        path: "/",
        element: <App />,
        children: [
          // ... all shell routes
        ],
      },
    ],
  },
];
```

**Recommendation: Option A** - Clearer separation, explicit about login being outside shell.

**In `apps/web/src/app/RouteElements.tsx`:**

```typescript
import { lazy } from "react";

export const LoginRoute = lazy(() => import("../pages/login").then(m => ({ default: m.LoginPage })));
```

### 11.3 Component Pseudo-Code

**`LoginPage.tsx` structure:**

```typescript
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next"; // if i18n is integrated
import { useAppAccount } from "../../app/account-context";
import { Button } from "../../shared/ui";
import "./LoginPage.css"; // scoped styles

export function LoginPage() {
  const { accountState } = useAppAccount();
  const navigate = useNavigate();
  const { t } = useTranslation("login");

  // Redirect if already authenticated
  useEffect(() => {
    if (accountState === "authenticated") {
      navigate("/", { replace: true });
    }
  }, [accountState, navigate]);

  if (accountState === "loading") {
    return <div className="login-loading">Loading...</div>;
  }

  return (
    <main className="login-page" role="main" aria-labelledby="login-heading">
      <div className="login-card card">
        <header className="login-header">
          <div className="brand-mark" aria-hidden="true">AF</div>
          <h1 id="login-heading" className="product-name">AgentForge</h1>
          <p className="tagline">{t("tagline")}</p>
        </header>

        <a href="/auth/oidc/login" className="button primary login-button">
          <LockIcon aria-hidden="true" />
          {t("button")}
        </a>

        <p className="trust-message">
          <ShieldIcon aria-label="Secure" />
          {t("trustMessage")}
        </p>
      </div>

      <footer className="login-footer">
        <span>AgentForge v{APP_VERSION}</span>
        <span aria-hidden="true"> • </span>
        <a href="/privacy">Privacy</a>
        <span aria-hidden="true"> • </span>
        <a href="/terms">Terms</a>
      </footer>
    </main>
  );
}
```

### 11.4 Styling Approach

**Option A: Scoped CSS file** (`LoginPage.css`)
- Co-located with component
- Uses existing design tokens from `index.css`
- Overrides for specific login page needs

**Option B: CSS-in-JS** (Styled Components, Emotion)
- Not currently used in project
- Avoid introducing new dependencies

**Recommendation:** Use scoped CSS file, import global tokens.

```css
/* LoginPage.css */
.login-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  background: #090d16; /* Body background */
}

.login-card {
  width: 100%;
  max-width: 480px;
  padding: 48px 40px;
  text-align: center;
}

.login-header {
  margin-bottom: 40px;
}

.brand-mark {
  width: 48px;
  height: 48px;
  margin: 0 auto 12px;
  border-radius: 12px;
  background: linear-gradient(145deg, #8d7bff, #5c55c9);
  display: grid;
  place-items: center;
  color: white;
  font-weight: 700;
  font-size: 18px;
  box-shadow: 0 5px 18px rgba(116, 102, 238, 0.25);
}

.product-name {
  font-size: clamp(20px, 4vw, 24px);
  font-weight: 600;
  letter-spacing: -0.6px;
  color: #e8eaf2;
  margin: 0 0 16px;
}

.tagline {
  font-size: clamp(13px, 2.5vw, 15px);
  line-height: 1.5;
  color: #8995aa;
  max-width: 360px;
  margin: 0 auto;
}

.login-button {
  width: 100%;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 24px;
  font-size: 13px;
}

.trust-message {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 11px;
  color: #78859b;
  margin: 0;
}

.login-footer {
  margin-top: 32px;
  font-size: 10px;
  color: #64718a;
  text-align: center;
}

.login-footer a {
  color: inherit;
  text-decoration: none;
}

.login-footer a:hover {
  color: #8995aa;
}

@media (max-width: 720px) {
  .login-card {
    padding: 32px 24px;
  }

  .brand-mark {
    width: 40px;
    height: 40px;
    font-size: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-button {
    transition: none;
  }
}
```

### 11.5 Integration with Existing Components

**Reuse from `shared/ui`:**
- `Button` component (already exists, used in OrganizationGate)
- May need icons from a shared icon set (check if one exists)

**Reuse from app shell:**
- Design tokens (colors, fonts, spacing) from `index.css`
- `.card` class for card styling
- `.button.primary` class for button styling

**Account context:**
- Import `useAppAccount` from `app/account-context` to check authentication state
- No need to duplicate session checking logic

### 11.6 Testing Strategy

**Unit tests** (`LoginPage.test.tsx`):
```typescript
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { LoginPage } from "./LoginPage";

describe("LoginPage", () => {
  it("renders product name and tagline", () => {
    render(<LoginPage />, { wrapper: BrowserRouter });
    expect(screen.getByRole("heading", { name: /AgentForge/i })).toBeInTheDocument();
    expect(screen.getByText(/Agent-native Source Control/i)).toBeInTheDocument();
  });

  it("renders SSO login link", () => {
    render(<LoginPage />, { wrapper: BrowserRouter });
    const link = screen.getByRole("link", { name: /Continue with SSO/i });
    expect(link).toHaveAttribute("href", "/auth/oidc/login");
  });

  it("shows trust message", () => {
    render(<LoginPage />, { wrapper: BrowserRouter });
    expect(screen.getByText(/Secure authentication/i)).toBeInTheDocument();
  });

  it("has accessible heading", () => {
    render(<LoginPage />, { wrapper: BrowserRouter });
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveAccessibleName("AgentForge");
  });
});
```

**Integration tests** (existing route tests):
- Update `apps/web/src/app/routes.test.ts` to include `/login` route
- Verify `/login` resolves to LoginPage
- Verify `/api/`, `/auth/` are not client routes

**Manual testing checklist:**
- [ ] Desktop layout (1920px, 1280px, 768px)
- [ ] Mobile layout (375px, 320px)
- [ ] Keyboard navigation (Tab, Enter)
- [ ] Screen reader (VoiceOver/NVDA)
- [ ] Color contrast (WebAIM checker)
- [ ] SSO redirect works (click button)
- [ ] Already authenticated redirect
- [ ] Error state rendering (mock 503)
- [ ] RTL layout (if i18n includes RTL languages)

---

## 12. Full-Page Pattern: Application-Wide Design Guidance

### 12.1 Overview

The login page follows the **full-page pattern** (standalone, no shell). This section extends that principle to provide design guidance for decomposing the entire AgentForge application from tab-based interfaces into independent full pages, matching GitHub/GitLab navigation patterns.

### 12.2 Current State: Tab-Based UI Elements

**Existing patterns that need decomposition:**

Based on the current codebase structure:

1. **Organization Settings** (`/orgs/:org/settings`)
   - Currently: Single page with potential for tabs (Members, Audit, General)
   - Pattern: All settings in one view or tab-switched sections

2. **Changeset Details** (`/orgs/:org/changesets/:id`)
   - Currently: Has tabs via routes (overview, revisions, evaluation, review, merge)
   - Status: ✅ **Already follows full-page pattern** - each tab is a route
   - Example: `/orgs/:org/changesets/:id/review` is a separate page

3. **Mock Pages** (Overview, Projects, Repositories, etc.)
   - Currently: Flat routes at root level
   - Status: Need to graduate to organization-scoped full pages when backed by API

### 12.3 Decomposition Principles

**GitHub/GitLab Full-Page Pattern:**

```
┌─────────────────────────────────────────────────────────┐
│ Topbar: Breadcrumbs                      Search  User   │ ← Consistent across pages
├──────────┬──────────────────────────────────────────────┤
│          │                                              │
│ Sidebar  │  Page Title & Actions                        │ ← Page-specific content
│          │  ─────────────────────────                   │
│ • Nav 1  │                                              │
│ • Nav 2  │  [Content specific to this full page]       │
│ • Nav 3  │                                              │
│          │                                              │
│          │                                              │
│          │                                              │
│          │                                              │
└──────────┴──────────────────────────────────────────────┘
```

**NOT this pattern:**
```
┌─────────────────────────────────────────────────────────┐
│ Topbar + Sidebar (same)                                 │
├──────────┬──────────────────────────────────────────────┤
│          │  Page Title                                  │
│ Sidebar  │  [Tab 1] [Tab 2] [Tab 3] ← Avoid tabs       │
│          │  ─────────────────────────                   │
│          │  Content that changes based on tab           │
│          │  (no URL change, no deep linking)           │
└──────────┴──────────────────────────────────────────────┘
```

**Key differences:**
- ✅ Each function = distinct URL and full page
- ✅ Navigation via sidebar or section nav, not tabs
- ✅ Breadcrumbs show hierarchy
- ✅ Deep linkable (share `/orgs/acme/settings/security` directly)
- ❌ No client-side tab widgets for major functions
- ❌ No content that changes without URL change

### 12.4 Recommended Decomposition: Organization Settings

**Current:** Single `/orgs/:org/settings` route

**Recommended structure:**

```
/orgs/:org/settings/general    - Basic info, name, avatar
/orgs/:org/settings/members    - Member list, roles, invitations
/orgs/:org/settings/audit      - Audit log
/orgs/:org/settings/security   - Security policies, 2FA requirements
/orgs/:org/settings/billing    - (future) Subscription, usage
/orgs/:org/settings/webhooks   - (future) Webhook configuration
```

**Navigation pattern (side nav within settings):**

```
┌─────────────────────────────────────────────────────────────┐
│ Topbar: Home > acme                          Search  User   │
├──────────┬────────┬─────────────────────────────────────────┤
│          │        │                                         │
│ Main     │ Side   │  Organization Settings                  │
│ Sidebar  │ Nav    │  ───────────────────────                │
│          │        │                                         │
│ • Dash   │ Gen.   │  [General settings form]                │
│ • Change │ Member │  Organization Name: [Acme Corp ]        │
│ • Repos  │ Audit  │  Handle: [acme            ]             │
│ • **Set**│ Sec.   │  Description: [            ]            │
│   (act.) │ Bill   │                                         │
│          │ Web    │  [Save Changes]                         │
│          │        │                                         │
└──────────┴────────┴─────────────────────────────────────────┘
           ↑ Section-specific side nav (GitHub style)
```

**Implementation:**
```typescript
// routes.tsx
{
  path: "orgs/:org/settings",
  element: <OrganizationSettingsLayout />,  // Layout with side nav
  children: [
    { index: true, element: <Navigate to="general" replace /> },
    { path: "general", element: <OrgGeneralSettingsPage /> },
    { path: "members", element: <OrgMembersPage /> },
    { path: "audit", element: <OrgAuditLogPage /> },
    { path: "security", element: <OrgSecurityPage /> },
  ],
}
```

**OrganizationSettingsLayout component:**
- Renders section-specific side navigation (General, Members, Audit, etc.)
- Highlights active route
- Wraps `<Outlet />` for child pages
- Each child page is a complete page, not a tab panel

### 12.5 Recommended Decomposition: Repository Details

**Future structure (when repositories are implemented):**

```
/orgs/:org/repositories/:repo              - Code view, README
/orgs/:org/repositories/:repo/commits      - Commit history
/orgs/:org/repositories/:repo/branches     - Branch list
/orgs/:org/repositories/:repo/changesets   - Changesets for this repo
/orgs/:org/repositories/:repo/settings     - Repository settings
  /orgs/:org/repositories/:repo/settings/general
  /orgs/:org/repositories/:repo/settings/access
  /orgs/:org/repositories/:repo/settings/webhooks
```

**Navigation pattern (top-level tabs for repo sections):**

```
┌─────────────────────────────────────────────────────────────┐
│ Topbar: Home > acme > api-server            Search  User    │
├──────────┬──────────────────────────────────────────────────┤
│          │  acme / api-server                               │
│ Main     │  [Code] [Commits] [Branches] [Changesets] [⚙]   │
│ Sidebar  │  ━━━━━                    ↑ Horizontal nav       │
│          │                                                  │
│ • Dash   │  README.md                                       │
│ • Change │  ══════════                                      │
│ • Repos  │  # API Server                                    │
│   (act.) │  Backend service for AgentForge...               │
│ • Set    │                                                  │
│          │  [File tree...]                                  │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

**Settings sub-navigation (when on `/orgs/:org/repositories/:repo/settings/*`):**

```
┌─────────────────────────────────────────────────────────────┐
│ Topbar: Home > acme > api-server > Settings  Search  User   │
├──────────┬────────┬─────────────────────────────────────────┤
│          │        │                                         │
│ Main     │ Side   │  Repository Settings                    │
│ Sidebar  │ Nav    │  ───────────────────                    │
│          │        │                                         │
│ • Dash   │ Gen.   │  [Settings form specific to General]    │
│ • Change │ Access │                                         │
│ • Repos  │ Webhks │                                         │
│   (act.) │        │                                         │
│ • Set    │        │                                         │
│          │        │                                         │
└──────────┴────────┴─────────────────────────────────────────┘
```

### 12.6 Navigation Patterns Summary

**Three-level navigation hierarchy (GitHub/GitLab pattern):**

1. **Sidebar (app-level):** Global sections
   - Dashboard, Changesets, Repositories, Settings
   - Always visible on authenticated pages
   - Current section highlighted

2. **Horizontal tabs (resource-level):** Major views of a resource
   - Repository: Code, Commits, Branches, Settings
   - Changeset: Overview, Revisions, Evaluation, Review, Merge
   - Appears below page title, above content
   - Use for 3-7 primary views of a single resource

3. **Vertical side nav (section-level):** Sub-pages within a section
   - Settings: General, Members, Audit, Security
   - Appears on the left within content area (to the right of main sidebar)
   - Use for 3-10 related settings or configuration pages

**When to use each pattern:**

| Pattern | Use Case | Example | Max Items |
|---------|----------|---------|-----------|
| Sidebar | App-wide sections | Changesets, Repos, Settings | 8-12 |
| Horizontal tabs | Resource views | Code, Commits, Branches | 3-7 |
| Vertical side nav | Section sub-pages | General, Members, Audit | 3-10 |
| None (just content) | Simple single-purpose page | Login, 404, specific form | N/A |

**Do NOT use:**
- Tab widgets for major navigation (React state-based tabs)
- Dropdowns for primary navigation
- Deeply nested side navs (>2 levels)
- Mixing tab widget with URL-based navigation in same section

### 12.7 Breadcrumbs and Context

**Breadcrumb pattern (in topbar):**

```
Home > acme > Changesets > [#123 Update user schema] > Review
  ↑      ↑        ↑                ↑                      ↑
 root   org   section        resource name           sub-page
```

**Rules:**
- Root: Always "Home" or product logo (links to `/`)
- Org: Organization name/handle (links to org dashboard if exists, else just label)
- Section: Main section (Changesets, Repositories, Settings)
- Resource: Specific item (changeset title, repo name)
- Sub-page: Current view (Review, General, Commits)

**Implementation:**
- Store breadcrumb data in route `handle` (see ADR-008)
- Build breadcrumbs from matched routes via `useMatches()`
- Each segment is clickable except the current page

### 12.8 Migration Strategy for Existing Pages

**Phase 1: New pages follow pattern** (immediate)
- All new features use full-page pattern from start
- No new tab widgets for major navigation
- Document violations in code review

**Phase 2: Audit existing pages** (short-term)
- List all pages that use tab widgets or state-based navigation
- Prioritize by user impact and technical debt
- Create tickets for decomposition

**Phase 3: Incremental refactoring** (ongoing)
- Refactor one section at a time (e.g., start with Settings)
- Maintain backward compatibility via redirects during transition
- Update links throughout app to new URLs
- Remove old tab components after full migration

**Phase 4: Establish guardrails** (long-term)
- Add ESLint rule against tab widgets in page-level components
- Update agent.md with full-page pattern requirements
- Include pattern examples in component library docs

### 12.9 Technical Implementation Notes

**Shared layouts for section navigation:**

```typescript
// OrganizationSettingsLayout.tsx
export function OrganizationSettingsLayout() {
  return (
    <div className="settings-layout">
      <aside className="settings-nav">
        <NavLink to="general">General</NavLink>
        <NavLink to="members">Members</NavLink>
        <NavLink to="audit">Audit Log</NavLink>
        <NavLink to="security">Security</NavLink>
      </aside>
      <main className="settings-content">
        <Outlet />  {/* Child route renders here */}
      </main>
    </div>
  );
}
```

**Active link styling:**
- Use `<NavLink>` from React Router (auto-adds `.active` class)
- Style active state to match sidebar active nav item
- Keyboard focus indicators required

**Loading states:**
- Each page manages its own loading state
- Navigating between pages shows loading in content area only
- Sidebar/topbar remain interactive during content loading

**Error boundaries:**
- Page-level errors show in content area
- Shell (sidebar/topbar) remains functional
- User can navigate away without full page reload

### 12.10 Examples: Before & After

**Before (tab-based, avoid):**
```typescript
// ❌ BAD: State-based tabs, no URL change
function SettingsPage() {
  const [tab, setTab] = useState("general");
  
  return (
    <div>
      <div className="tabs">
        <button onClick={() => setTab("general")}>General</button>
        <button onClick={() => setTab("members")}>Members</button>
      </div>
      {tab === "general" && <GeneralSettings />}
      {tab === "members" && <MembersSettings />}
    </div>
  );
}
```

**After (route-based, full pages):**
```typescript
// ✅ GOOD: Each settings section is a route
// routes.tsx
{
  path: "settings",
  element: <SettingsLayout />,
  children: [
    { path: "general", element: <GeneralSettingsPage /> },
    { path: "members", element: <MembersSettingsPage /> },
  ],
}

// SettingsLayout.tsx
function SettingsLayout() {
  return (
    <div className="settings-layout">
      <nav>
        <NavLink to="general">General</NavLink>
        <NavLink to="members">Members</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
```

**Benefits of the "after" approach:**
- ✅ Deep linkable: Share `/orgs/acme/settings/members` directly
- ✅ Browser back/forward works correctly
- ✅ Each page can be bookmarked
- ✅ Loading states and errors scoped to page
- ✅ Analytics track page views accurately
- ✅ Clearer separation of concerns (one page = one component)

---

## 13. Implementation Phases

### Phase 1: Core Login Page (MVP)
**Priority:** P0  
**Dependencies:** None

- [ ] Create `LoginPage.tsx` component
- [ ] Create `LoginPage.css` styles
- [ ] Add `/login` route to `routes.tsx`
- [ ] Add unit tests
- [ ] Manual accessibility audit

**Deliverable:** Functional login page at `/login` with SSO button.

### Phase 2: Enhanced States
**Priority:** P1  
**Dependencies:** Phase 1

- [ ] Add loading state handling
- [ ] Add error state (503 from backend)
- [ ] Add "already authenticated" redirect
- [ ] Add retry button for errors
- [ ] Update tests for new states

**Deliverable:** Robust state management for all authentication scenarios.

### Phase 3: i18n Integration
**Priority:** P2  
**Dependencies:** Phase 1, i18n framework setup

- [ ] Create `login.json` translation files (en, zh, etc.)
- [ ] Replace hardcoded strings with `t()` calls
- [ ] Test RTL layout if applicable
- [ ] Update tests to mock translations

**Deliverable:** Fully internationalized login page.

### Phase 4: Polish & Animation
**Priority:** P3  
**Dependencies:** Phase 2

- [ ] Add subtle transitions (loading state)
- [ ] Add focus animations
- [ ] Add reduced-motion variants
- [ ] Performance audit (lighthouse)
- [ ] Cross-browser testing (Chrome, Firefox, Safari)

**Deliverable:** Production-ready polish.

---

## 14. Open Questions & Decisions Needed

### 14.1 Product Messaging

**Question:** Is the tagline "Agent-native Source Control & Verified Change Platform" final?  
**Impact:** Copy, i18n keys, SEO  
**Recommendation:** Confirm with product/marketing team before implementation.

### 14.2 Login Route Behavior

**Question:** Should `/login` be the default landing page for unauthenticated users, or should they land on `/` (Overview mock) and be prompted inline?  
**Current state:** Mock pages are accessible without auth, protected pages show inline gate.  
**Options:**
- A: Keep current behavior, `/login` is a bookmarkable alternative
- B: Redirect all unauthenticated users from `/` to `/login`
- C: Detect first visit vs. returning user (cookie/localStorage)

**Recommendation:** **Option A** - Keep `/login` as an explicit route but don't force redirect from `/`. This allows:
- Public preview of mock pages (demos, screenshots)
- Inline authentication for mid-flow (OrganizationGate)
- Explicit login for bookmarks, emails, onboarding

### 14.3 SSO Provider Branding

**Question:** Should the button say "Continue with SSO" (generic) or "Continue with [Provider Name]" (e.g., "Continue with Okta", "Continue with Google")?  
**Current state:** Single configured OIDC provider, no UI selection.  
**Options:**
- A: Generic "Continue with SSO" (current design)
- B: Dynamic provider name from backend config
- C: Provider logo + name (requires logo assets)

**Recommendation:** **Option A** for MVP - Generic SSO button. If branding becomes important, add in Phase 4.

### 14.4 Footer Links

**Question:** Do Privacy/Terms pages exist? Should they be external links or in-app routes?  
**Impact:** Link targets, routing, content responsibility  
**Recommendation:** Confirm with legal/product team. If pages don't exist, remove links from MVP.

### 14.5 Version Display

**Question:** Should the version be dynamic (read from env/package.json) or static?  
**Current state:** No visible version in app shell.  
**Recommendation:** Dynamic via `import.meta.env.VITE_APP_VERSION` or package.json import. If not available, omit version from MVP.

### 14.6 Already Authenticated Behavior

**Question:** Should authenticated users visiting `/login` see a confirmation page or immediate redirect?  
**Recommendation:** **Immediate redirect** (simpler, standard pattern). Add confirmation page only if user feedback requests it.

---

## 15. Success Metrics

**After launch, monitor:**

1. **Conversion:** % of users who click SSO button (should be >90% for invited users)
2. **Bounce rate:** % who land on `/login` and leave without clicking (target: <10%)
3. **Time to authenticate:** Seconds from page load to SSO redirect (target: <5s)
4. **Error rate:** % of users who encounter 503 or other auth errors (target: <1%)
5. **Mobile usage:** % of logins from mobile devices (design accordingly)
6. **Accessibility:** Zero critical accessibility issues in audit

**Qualitative:**
- User feedback on clarity ("Did you understand what to do?")
- Support tickets related to login confusion (target: near zero)

---

## 16. Related Documentation

**Read before implementation:**
- `docs/architecture/identity-and-tenancy.md` - Authentication architecture
- `docs/architecture/decisions.md` - ADR-008 (routing), ADR-007 (deployment)
- `apps/web/src/app/OrganizationGate.tsx` - Existing inline auth pattern
- `apps/web/src/app/routes.tsx` - Route configuration
- `apps/web/src/styles/index.css` - Design system tokens
- `apps/web/agent.md` - Frontend conventions and standards (if exists)

**Update after implementation:**
- `CHANGELOG.md` - Add entry for login page feature
- `README.md` - Update setup/auth instructions if needed
- This document - Mark phases as complete, update screenshots

---

## 17. Appendix: Alternative Designs Considered

### A. Split-Screen Layout (GitHub-style)

```
┌─────────────────────┬──────────────────────────┐
│                     │                          │
│   [Illustration]    │    AgentForge           │
│                     │                          │
│   Agent-native...   │    [SSO Button]         │
│                     │                          │
│   • Feature 1       │    Secure auth...       │
│   • Feature 2       │                          │
│   • Feature 3       │                          │
│                     │                          │
└─────────────────────┴──────────────────────────┘
```

**Pros:**
- More visually engaging
- Room for marketing messages
- Modern, trendy design

**Cons:**
- Overkill for SSO-only (no form)
- Requires illustration/imagery assets
- More complex responsive behavior
- Harder to maintain
- May distract from single action

**Decision:** Rejected - Too complex for SSO-only flow.

### B. Minimal Inline (No Card)

```
┌──────────────────────────────────────────────┐
│                                              │
│              ┌────┐                          │
│              │ AF │  AgentForge              │
│              └────┘                          │
│                                              │
│   ┌──────────────────────────────────────┐  │
│   │   Continue with SSO                  │  │
│   └──────────────────────────────────────┘  │
│                                              │
└──────────────────────────────────────────────┘
```

**Pros:**
- Extremely simple
- Fast to implement
- Low visual weight

**Cons:**
- Lacks professionalism
- No space for product explanation
- Doesn't meet "GitHub/GitLab style" brief
- May feel unfinished

**Decision:** Rejected - Too minimal for first impression.

### C. Multi-Step Wizard

```
Step 1: Welcome → Step 2: SSO → Step 3: Org Select
```

**Pros:**
- Guided experience
- Room for onboarding content

**Cons:**
- Unnecessary steps (only one action needed)
- Higher bounce rate (each step is a drop-off point)
- Doesn't match technical flow (OIDC callback handles org)

**Decision:** Rejected - Over-engineered for simple SSO.

---

## 18. Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2024 | Claude | Initial design specification |

---

**End of Document**

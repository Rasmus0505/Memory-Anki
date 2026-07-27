import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import boundaries from 'eslint-plugin-boundaries'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    settings: {
      // 顶层目录方向约束由 ESLint 把关；modules 之间必须走 public.ts 的细则
      // 由 tools/check_architecture.py 独管，两者不重复配置。
      'boundaries/elements': [
        { type: 'app', mode: 'full', pattern: 'src/app/**/*' },
        { type: 'pages', mode: 'full', pattern: 'src/pages/**/*' },
        { type: 'widgets', mode: 'full', pattern: 'src/widgets/**/*' },
        { type: 'modules', mode: 'full', pattern: 'src/modules/**/*' },
        { type: 'platform', mode: 'full', pattern: 'src/platform/**/*' },
        { type: 'pwa', mode: 'full', pattern: 'src/pwa/**/*' },
        { type: 'shared', mode: 'full', pattern: 'src/shared/**/*' },
        { type: 'test', mode: 'full', pattern: 'src/test/**/*' },
      ],
      // 旧配置失效的根因之一：没有 resolver，'@/' 别名从未解析成功，
      // boundaries 规则实际从未触发。
      'import/resolver': {
        typescript: {
          project: ['tsconfig.app.json'],
        },
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { boundaries },
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'boundaries/element-types': ['error', {
        default: 'disallow',
        rules: [
          { from: 'app', allow: ['app', 'pages', 'widgets', 'modules', 'platform', 'pwa', 'shared'] },
          { from: 'pages', allow: ['pages', 'widgets', 'modules', 'shared'] },
          { from: 'widgets', allow: ['widgets', 'modules', 'shared'] },
          { from: 'modules', allow: ['modules', 'shared', 'platform'] },
          { from: 'platform', allow: ['platform', 'shared'] },
          // platform 是端口适配层：允许只引 modules 的类型（端口接口定义）。
          { from: 'platform', allow: ['modules'], importKind: 'type' },
          { from: 'pwa', allow: ['pwa', 'shared'] },
          { from: 'shared', allow: ['shared'] },
          { from: 'test', allow: ['test', 'app', 'pages', 'widgets', 'modules', 'platform', 'pwa', 'shared'] },
        ],
      }],
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // 测试与测试支撑文件豁免层间约束（与 check_architecture.py 跳过测试一致）。
    files: ['**/*.test.{ts,tsx}', '**/*.test-support.{ts,tsx}', 'src/test/**/*'],
    rules: {
      'boundaries/element-types': 'off',
    },
  },
  {
    // 存量越层例外（显式清单，新文件不得加入；根治已登记为后续任务）：
    // - modules→widgets：practice/quiz 引 mindmap-review-flow、palace-memory-lookup
    //   等 widget，根治 = 把被引 API 下沉到对应 module 的 public。
    // - shared→modules：timedSession 系列与 SessionTimerBar 等引 session/settings
    //   public，根治 = 整块下沉 modules/session。
    // - modules→pwa：ProfileSettingsPage 直接调 resetPwaRuntime，根治 = 经 platform 端口。
    files: [
      'src/modules/practice/ui/freestyle/components/FreestyleDialogsHost.tsx',
      'src/modules/practice/ui/freestyle/components/FreestyleMindMapBranchCardView.tsx',
      'src/modules/practice/ui/freestyle/components/freestyleAnkiSettle.ts',
      'src/modules/practice/ui/freestyle/components/freestyleBranchCardSupport.ts',
      'src/modules/quiz/ui/palace-quiz/PalaceQuizPage.tsx',
      'src/modules/settings/ui/profile/ProfileSettingsPage.tsx',
      'src/shared/components/session/SessionTimerBar.tsx',
      'src/shared/components/session/timer-automation-config.ts',
      'src/shared/hooks/timedSessionModel.ts',
      'src/shared/hooks/timedSessionRecovery.ts',
      'src/shared/hooks/timedSessionRestore.ts',
      'src/shared/hooks/timedSessionSnapshot.ts',
      'src/shared/hooks/useTimedSession.ts',
      'src/shared/logs/components/AppLogDrawer.tsx',
      'src/shared/preferences/clientPreferences.ts',
    ],
    rules: {
      'boundaries/element-types': 'off',
    },
  },
])

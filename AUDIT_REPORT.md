# Auditoría y reparación de Xoshi XI

**Rama de trabajo:** `fix/xoshi-xi-playwright-dry-run`
**Base auditada:** `main` en `6b852d6d3a8ef454d3630f2aedc1189ad62aca77` (`Add files via upload`)
**Fecha de auditoría:** 2026-10-11

## Diagnóstico inicial

| Área | Estado inicial | Evidencia |
|---|---|---|
| Rama y árbol de trabajo | `main`, limpio | `git status --short --branch` antes de crear la rama de reparación |
| TypeScript | Bloqueado | `npx tsc --noEmit` devolvió 23 errores `TS1005` en `x-agent/run_cycle.ts:12-14` |
| GitHub Actions | Fallido | La ejecución programada `37994646955` sobre `6b852d6` falló en el paso **TypeScript check** con los mismos `TS1005` |
| Tests | Ausentes | No había archivos de prueba del proyecto ni script `test` |
| Python estático | Correcto | `python3 -m py_compile backend/main.py` pasó antes de los cambios |
| Dependencias Node de producción | Sin vulnerabilidades conocidas | `npm audit --omit=dev` pasó; se añadió un lockfile reproducible |

## Causas raíz

1. **El ciclo no se podía interpretar.** `RADAR_QUERIES` contenía comillas duplicadas e internas sin escapar. El parser se detenía antes de poder validar el resto del programa. Por eso los errores conocidos de `clearOverlays`, `safeClick` y `Locator` no podían evaluarse de forma fiable en esa revisión: el snapshot ya contenía las funciones y el import de `Locator`, pero el módulo ni siquiera se compilaba.
2. **El radar era frágil ante el DOM real de X.** Dependía de esperas fijas, extraía el primer enlace de perfil como autor y no priorizaba el permalink asociado al `<time>` del post. Cualquier cambio de orden de enlaces o carga tardía podía producir cero candidatos útiles.
3. **La publicación no se verificaba.** El flujo anterior podía devolver éxito tras `Ctrl+Enter` aunque el editor siguiera lleno. Eso arriesgaba guardar memoria de una respuesta no publicada y, al reintentar, duplicar la acción.
4. **Gestión de overlays insegura.** El fallback de clic forzado puede actuar a través de una capa visual. Además, Escape no comprobaba si ya había un editor abierto.
5. **CI no era reproducible ni ejercitaba el flujo.** No había `package-lock.json`, se empleaba `npm install`, y Actions sólo hacía la comprobación TypeScript ya fallida.

## Reparaciones aplicadas

### Playwright y ciclo TypeScript

- Se corrigieron las siete consultas del radar y se añadió `buildSearchUrl` con codificación explícita.
- Se mantienen **Chromium, Playwright, cookies de sesión y los flujos existentes**. No se sustituyó la arquitectura ni se intentó sortear verificaciones de X.
- `clearOverlays`, `safeClick` y `Locator` se conservan como helpers locales con tipos explícitos. `safeClick` sólo hace clic normal y visible; se retiró el clic forzado.
- `clearOverlays` nunca envía Escape si ya hay un editor visible; intenta primero cerrar diálogos identificables.
- Se añadieron selectores alternativos y esperas acotadas para editor, tweet cards, reply button y composer. Los diagnósticos registran contadores de artículos, tarjetas y permalinks, sin cookies ni valores de secreto.
- La extracción usa primero enlaces `a:has(time)[href*="/status/"]`, deduplica IDs y deriva el autor del permalink, evitando el primer enlace de perfil irrelevante.
- Una publicación sólo se considera `sent` si el editor se vacía o desaparece. Fallos de verificación **no** se guardan en memoria.
- Se añadieron límites de respuesta configurables, un único reintento para 408/429/5xx/red y deduplicación durante el ciclo.

### DRY_RUN y memoria

- `DRY_RUN=true` permite navegar, descubrir posts, generar texto y llenar editores sin publicar en X.
- En simulación no se actualiza Gist ni se marca una respuesta/post como procesado. Por tanto, un dry run no oculta trabajo real futuro.
- La memoria se elevó a versión 3 y guarda los posts diarios verificados recientes para evitar publicar el mismo texto tras el cooldown.
- Radar sólo guarda `radarSeen` y la interacción después de una respuesta verificada.

### Backend FastAPI

- Groq continúa siendo proveedor principal; Gemini es fallback. Cada proveedor tiene como máximo dos intentos, reintentando sólo timeouts, 408, 429 y 5xx.
- Respuestas malformadas de proveedores ya no derriban el endpoint.
- Se detectan de manera determinista inglés, español, catalán, francés, alemán, portugués e italiano; la instrucción de respuesta solicita el idioma detectado y existe fallback seguro en cada idioma.
- El prompt refuerza que las publicaciones entrantes son contenido no verificado y prohíbe inventar precios, contratos, noticias, asociaciones o datos financieros.
- Los logs de errores informan tipo/status, no headers, cookies ni claves.

### GitHub Actions y dependencias

- Se añadió `x-agent/package-lock.json`, `npm ci`, caché npm y permisos mínimos `contents: read`.
- CI ahora ejecuta: typecheck, simulación local Playwright en `DRY_RUN`, tests Python y health check HTTP del backend antes del ciclo.
- El workflow manual recibe `dry_run`; en ejecuciones programadas y push a `main` el valor por defecto es `false`.
- Las claves Groq/Gemini se retiraron del entorno del job Node, ya que el backend Render es quien las usa; se redujo exposición innecesaria de secretos.

## Archivos modificados o añadidos

| Archivo | Cambio |
|---|---|
| `x-agent/run_cycle.ts` | Corrección de compilación, selectores, extracción, publicación verificada, reintentos y `DRY_RUN` |
| `x-agent/memory.ts` | Memoria v3, deduplicación de publicaciones verificadas y logs seguros |
| `x-agent/tsconfig.json` | `strict: true`; comprobación de todos los `.ts` del agente y pruebas |
| `x-agent/package.json` / `x-agent/package-lock.json` | Script de test y lockfile reproducible |
| `x-agent/tests/run_cycle_helpers.test.ts` | Tests de URL/ID y memoria |
| `x-agent/tests/dry_run_simulation.ts` | Ciclo completo contra mock local de X/Backend con Chromium |
| `backend/main.py` | Resiliencia de proveedores, idioma y guardrails factuales |
| `backend/tests/test_main.py` | Pruebas de idiomas, fallback, limpieza y health |
| `.github/workflows/xoshi_cycle.yml` | CI reproducible, pruebas, permisos mínimos y entrada `dry_run` |
| `README.md` | Instrucciones de simulación y validación |

## Validaciones ejecutadas

| Comando / prueba | Resultado |
|---|---|
| Baseline: `npx tsc --noEmit` | **Falló** con 23 `TS1005`; confirmado también en Actions histórico |
| Reparado: `npx tsc --noEmit` | **Pasó** |
| `npm test` | **Pasó**: helpers TypeScript y simulación Chromium/Playwright del ciclo con `DRY_RUN` |
| `python3 -m unittest discover -s tests -p 'test_*.py'` | **Pasó**: 4 pruebas |
| `python3 -m py_compile main.py` | **Pasó** |
| Health HTTP local con Uvicorn + `curl` | **Pasó** (`ok: true`) |
| `npm audit --omit=dev` | **Pasó**: 0 vulnerabilidades conocidas |
| `npm ci --ignore-scripts` | **Pasó**: instalación reproducible |
| `git diff --check` | **Pasó** |
| Validación YAML del workflow | **Pasó** |

## Límites y siguientes pasos

1. La simulación prueba selectores, navegación, llenado de editor y ausencia de escritura contra un mock determinista. No sustituye la observación de la UI autenticada de X, que cambia con frecuencia.
2. Ejecutar el workflow manual con `dry_run=true` sobre esta rama valida que Actions usa el commit reparado sin publicar ni alterar memoria. Después, revisar sus diagnósticos de contadores de DOM antes de habilitar publicaciones reales.
3. Confirmar en Render que `GROQ_MODEL` y `GEMINI_MODEL` son modelos actualmente habilitados para sus respectivas claves. El backend degrada con seguridad al fallback si un proveedor/cuota falla, pero no se usaron claves reales durante la auditoría local.
4. Mantener `FASTAPI_URL`, cookies de X y credenciales Gist exclusivamente como secretos de Actions/Render. No se añadieron ni imprimieron valores sensibles.

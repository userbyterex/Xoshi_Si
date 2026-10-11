# Auditoría y reparación de Xoshi XI

**Rama de entrega:** `feat/verified-project-radar`
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

### Radar de proyectos EVM y Solana

- Se añaden métricas públicas de DeFiLlama y controles explícitos GoPlus para EVM; para Solana se normaliza el prefijo de mint de DeFiLlama y se combinan GoPlus con resumen RugCheck en caché.
- Se rechazan flags de riesgo, controles administrativos desconocidos, datos incompletos, baja liquidez y concentración de los principales holders por encima del umbral. Una ficha sin todas sus fuentes y disclaimer no llega al editor.
- Las métricas y textos se generan con plantilla determinista, no con el LLM, para no inventar hechos. Se deduplica contra publicaciones recientes; nunca se afirma que un scan garantice que no habrá rug.
- El sondeo real de solo lectura encontró 10 candidatas métricas EVM y 2 Solana; ninguna superó todos los controles. FastAPI respondió con `post: ""` y motivo de abstención. No se publicó en X.

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
| `backend/main.py` | Resiliencia de proveedores, idioma, guardrails y conexión al radar |
| `backend/project_watch.py` | Descubrimiento y vetos de riesgo con fuentes verificables EVM/Solana |
| `backend/tests/test_main.py` | Pruebas de idiomas, fallback, limpieza y health |
| `backend/tests/test_project_watch.py` | Tests de selección, fuentes, duplicados y controles EVM/Solana |
| `PROJECT_WATCH_POLICY.md` | Umbrales, fuentes y evidencia del sondeo en vivo |
| `.github/workflows/xoshi_cycle.yml` | CI reproducible, pruebas, permisos mínimos y entrada `dry_run` |
| `README.md` | Instrucciones de simulación y validación |

## Validaciones ejecutadas

| Comando / prueba | Resultado |
|---|---|
| Baseline: `npx tsc --noEmit` | **Falló** con 23 `TS1005`; confirmado también en Actions histórico |
| Reparado: `npx tsc --noEmit` | **Pasó** |
| `npm test` | **Pasó**: helpers TypeScript y simulación Chromium/Playwright del ciclo con `DRY_RUN` |
| `python3 -m unittest discover -s backend/tests -p 'test_*.py'` | **Pasó**: 13 pruebas |
| `python3 -m py_compile backend/main.py backend/project_watch.py` | **Pasó** |
| Health + `POST /api/reading/market_cycle` local con Uvicorn | **Pasó**; endpoint devolvió abstención al no hallar candidato y no invocó X |
| `npm audit --omit=dev` | **Pasó**: 0 vulnerabilidades conocidas |
| `npm ci --ignore-scripts` | **Pasó**: instalación reproducible |
| `git diff --check` | **Pasó** |
| [GitHub Actions `38174954768`](https://github.com/userbyterex/Xoshi_Si/actions/runs/38174954768), SHA `c75e68e` | **Pasó** con `dry_run=true`; no publicó ni guardó memoria |
| Workflow YAML y migración a actions Node 24 | **Pasó**; usa `ubuntu-24.04`, checkout v5, setup-node v6, setup-python v6 y upload-artifact v6 |

## Límites y siguientes pasos

1. DRY_RUN y el smoke HTTP terminaron sin publicar. No apareció candidato elegible en la instantánea consultada; no se deben relajar los vetos para forzar una publicación.
2. El PR [#1](https://github.com/userbyterex/Xoshi_Si/pull/1) está abierto contra `main`; no se ha fusionado. Tras fusionarlo, Render debe desplegar el nuevo `backend/` antes de que el cron de `main` use el radar de proyectos.
3. La ejecución DRY_RUN observó cero menciones y cero resultados del radar de X; la simulación DOM sigue siendo contra un mock y no certifica a largo plazo la UI autenticada de X.
4. Confirmar en Render que `GROQ_MODEL` y `GEMINI_MODEL` están habilitados para sus claves; durante esta tarea no se probaron claves de proveedor reales.
5. Mantener `FASTAPI_URL`, cookies de X y credenciales Gist exclusivamente como secretos de Actions/Render. No se añadieron ni imprimieron valores sensibles.

## Compatibilidad de GitHub Actions

La primera ejecución DRY_RUN reveló que las actions v4/v5 del workflow aún declaraban el runtime Node 20 y que `ubuntu-latest` migraría pronto de imagen. Se actualizaron `checkout@v5`, `setup-node@v6`, `setup-python@v6` y `upload-artifact@v6` (sus manifiestos oficiales declaran `node24`) y se fijó `ubuntu-24.04`. Referencias oficiales: [aviso de retiro de Node 20](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/), [checkout v5 y runner mínimo](https://github.com/actions/checkout/releases/tag/v5.0.0), [manifiestos de checkout](https://raw.githubusercontent.com/actions/checkout/v5/action.yml), [setup-node](https://raw.githubusercontent.com/actions/setup-node/v6/action.yml), [setup-python](https://raw.githubusercontent.com/actions/setup-python/v6/action.yml) y [upload-artifact](https://raw.githubusercontent.com/actions/upload-artifact/v6/action.yml). La segunda ejecución DRY_RUN (SHA `c75e68e`) terminó correctamente y sus logs no muestran advertencias Node 20 ni de migración `ubuntu-latest`.

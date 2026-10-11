# Política de radar de proyectos cripto

El post diario de mercado ahora intenta seleccionar un proyecto DeFi con datos observables. La selección es una **lista de seguimiento editorial**, no una recomendación de compra. El texto se compone a partir de métricas de fuente y siempre incorpora las URL de la métrica y de los dos escaneos.

## Puerta de publicación

Un candidato solo puede llegar al composer cuando:

1. La API pública de DeFiLlama devuelve un proyecto con slug, mint/contrato válido y TVL de al menos `PROJECT_MIN_TVL_USD` (25 millones USD por defecto), en una cadena EVM soportada o Solana. Se exige cambio de TVL positivo a siete días. El ranking usa ese cambio y el TVL. El movimiento de TVL **no equivale necesariamente a entradas netas**, pues también puede reflejar variaciones del valor de los activos.
2. Para EVM, GoPlus Token Security debe devolver los campos clave explícitos y sin flags de honeypot, mint, blacklist, controles del propietario, proxy, restricciones de venta, etc.; además, debe informar DEX, impuestos conocidos y moderados y liquidez por encima de `PROJECT_MIN_DEX_LIQUIDITY_USD` (250 000 USD por defecto).
3. Para Solana, GoPlus Solana Token Security debe reportar sin controles de emisión/cierre, congelación, cambios de balances, fees/hook actualizables, hook externo ni creadores maliciosos. Se exige liquidez observada y concentración de los diez principales holders no superior al umbral codificado del 50%.
4. El segundo control es la API beta de GoPlus Rug-pull Detection en EVM y el resumen de RugCheck con `cacheOnly=true` para Solana. Los datos de RugCheck solo se aceptan si existe un resumen y no hay hallazgos de nivel no informativo. Un error, respuesta vacía, dato desconocido, timeout, campo ausente o cadena no soportada significa **abstenerse**, nunca “seguro”.
5. El post nombra el proyecto, enlaza DeFiLlama y las respuestas concretas de ambos escáneres, incluye “not a buy call” (o “not an endorsement”) y advierte que los resultados no descartan un rug pull. Si el backend devuelve contenido sin las tres fuentes aprobadas o sin el aviso, Playwright lo rechaza antes de abrir el editor.
6. Los posts de los últimos siete días se excluyen para evitar destacar repetidamente el mismo proyecto.

Los contratos, métricas y escaneos son instantáneas de terceros. **Ningún escaneo puede garantizar que un proyecto no haga rug pull**, y pasar estas reglas no significa que sea seguro. El texto dice “los escaneos automáticos no reportaron flags”, no “es seguro”, “está auditado” ni “no es un rug”.

El alcance cubre las cadenas EVM expresamente mapeadas y Solana. Otras cadenas se omiten; no se rellena el hueco con una respuesta del modelo. Los proyectos sin contrato/mint/ticker/datos suficientemente completos tampoco se publican.

## Fuentes consultadas por el agente

- [API pública de protocolos y TVL de DeFiLlama](https://api-docs.defillama.com/), con el endpoint de datos `https://api.llama.fi/protocols` y ficha por proyecto `https://defillama.com/protocol/{slug}`.
- [GoPlus Token Security API](https://docs.gopluslabs.io/reference/tokensecurityusingget_1) y [definiciones de campos de riesgo](https://docs.gopluslabs.io/reference/response-details).
- [GoPlus Rug-pull Detection API beta](https://docs.gopluslabs.io/reference/getdefiinfousingget) y [definiciones de respuesta](https://docs.gopluslabs.io/reference/response-details-7).
- [GoPlus Solana Token Security API beta](https://docs.gopluslabs.io/reference/solanatokensecurityusingget) y [campos de riesgo Solana](https://docs.gopluslabs.io/reference/response-detail-1).
- [RugCheck API OpenAPI](https://api.rugcheck.xyz/swagger/doc.json), usada solo con informes en caché para evitar generar informes pagados.
- [Documentación oficial de Solana sobre autoridades de mint](https://solana.com/docs/tokens/basics/set-authority).

La selección se realiza en el backend; si cualquiera de las fuentes críticas no está disponible, no se genera un post diario de proyecto. El flujo ordinario de respuestas a menciones no se convierte en promoción de proyectos y conserva su deduplicación actual.

## Verificación de esta implementación

En la consulta de solo lectura ejecutada el 2026-10-11, DeFiLlama devolvió 8 694 registros. Diez registros EVM y dos Solana cumplieron los filtros métricos/contractuales; tras la verificación de riesgo, **ninguno pasó todos los controles**. El resultado fue cero proyectos publicables y no se publicó nada. Esta abstención es intencional; los contadores se registran sin imprimir cookies ni credenciales.

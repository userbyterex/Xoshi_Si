# Política de radar de proyectos cripto

El workflow actual corre cada hora. Considera una señal “bullish” **solo** si un protocolo tiene TVL alto con variación positiva a siete días y supera todos los controles de riesgo descritos aquí. Es una señal de tendencia de TVL, **no una predicción de precio, recomendación de compra ni afirmación de noticias alcistas**.

## Publicación

- Máximo **3 posts de proyectos en cualquier ventana móvil de 24 horas**. El límite se cuenta desde `recentPosts` de la memoria Gist persistente; si no se pueden cargar las credenciales o el snapshot, el agente se abstiene de publicar. GitHub Actions serializa los ciclos para que ejecuciones concurrentes no compitan por el contador. `DRY_RUN` simula el flujo sin escribir en X ni en Gist.
- El mismo proyecto/mint se excluye durante **7 días** después de un post verificado; la exclusión se aplica antes de seleccionar la siguiente candidata.
- Cada post incluye tres fuentes clicables, una advertencia de riesgo, el texto explícito “TVL trend only, not a buy call” y **1–3 hashtags derivados solo de la categoría y cadena informadas por DeFiLlama**. No se inventan tags de precio, asociaciones, noticias o contratos.
- Playwright comprueba de nuevo los enlaces de evidencia, el disclaimer y la presencia de entre uno y tres hashtags antes de abrir el editor.

## Puerta de verificación

Un candidato solo puede llegar al composer cuando:

1. La API pública de DeFiLlama devuelve un proyecto con slug, mint/contrato válido y TVL de al menos `PROJECT_MIN_TVL_USD` (25 millones USD por defecto), en una cadena EVM soportada o Solana. Se exige cambio de TVL positivo a siete días. El ranking usa ese cambio y el TVL. El movimiento de TVL **no equivale necesariamente a entradas netas**, pues también puede reflejar variaciones del valor de los activos.
2. Para EVM, GoPlus Token Security debe devolver los campos clave explícitos, sin flags de honeypot, mint, blacklist, controles del propietario, proxy, restricciones de venta u otros controles vetados. Debe informar negociación DEX, impuestos conocidos y moderados y liquidez por encima de `PROJECT_MIN_DEX_LIQUIDITY_USD` (250 000 USD por defecto).
3. Para Solana, GoPlus Solana Token Security debe reportar sin controles de emisión/cierre, congelación, cambios de balances, fees/hook actualizables, hook externo ni creadores maliciosos. Se exige liquidez observada y concentración de los diez principales holders no superior al umbral codificado del 50%.
4. El segundo control es la API beta GoPlus Rug-pull Detection en EVM y el resumen de RugCheck con `cacheOnly=true` para Solana. Los datos de RugCheck solo se aceptan si existe resumen y no hay hallazgos de nivel no informativo. Un error, respuesta vacía, dato desconocido, timeout, campo ausente o cadena no soportada significa **abstenerse**, nunca “seguro”.
5. Un proyecto publicado no vuelve a promocionarse durante siete días, incluso si reaparece en varios registros de protocolos.

Los contratos, métricas y escaneos son instantáneas de terceros. **Ningún escaneo puede garantizar que un proyecto no haga rug pull**, y pasar estas reglas no significa que sea seguro. El texto dice “los escaneos automáticos no reportaron flags”, no “es seguro”, “está auditado” ni “no es un rug”.

El alcance cubre las cadenas EVM expresamente mapeadas y Solana. Otras cadenas se omiten; no se rellena el hueco con una respuesta del modelo. Los proyectos sin contrato/mint/ticker/datos suficientemente completos tampoco se publican.

## Fuentes consultadas por el agente

- [API pública de protocolos y TVL de DeFiLlama](https://api-docs.defillama.com/), con el endpoint de datos `https://api.llama.fi/protocols` y ficha por proyecto `https://defillama.com/protocol/{slug}`.
- [GoPlus Token Security API](https://docs.gopluslabs.io/reference/tokensecurityusingget_1) y [definiciones de campos de riesgo](https://docs.gopluslabs.io/reference/response-details).
- [GoPlus Rug-pull Detection API beta](https://docs.gopluslabs.io/reference/getdefiinfousingget) y [definiciones de respuesta](https://docs.gopluslabs.io/reference/response-details-7).
- [GoPlus Solana Token Security API beta](https://docs.gopluslabs.io/reference/solanatokensecurityusingget) y [campos de riesgo Solana](https://docs.gopluslabs.io/reference/response-detail-1).
- [RugCheck API OpenAPI](https://api.rugcheck.xyz/swagger/doc.json), usada solo con informes en caché para evitar generar informes pagados.
- [Documentación oficial de Solana sobre autoridades de mint](https://solana.com/docs/tokens/basics/set-authority).

El flujo ordinario de respuestas a menciones no se convierte en promoción de proyectos y conserva su deduplicación actual.

## Verificación de esta implementación

En la consulta de solo lectura ejecutada el 2026-10-11, DeFiLlama devolvió 8 694 registros. Diez registros EVM y dos Solana cumplieron los filtros métricos/contractuales; tras la verificación de riesgo, **ninguno pasó todos los controles**. El resultado fue cero proyectos publicables y no se publicó nada. Esta abstención es intencional; los contadores se registran sin imprimir cookies ni credenciales.

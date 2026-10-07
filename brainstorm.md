# Brainstorm — Selective disclosure respondida por el suscriptor + respaldo cifrado

Estado: **CONSTRUIDO, FALTA PROBAR EN VIVO (2026-09-24)**. Los pasos 1 a 4 del "Plan actualizado"
están implementados y subidos (`9cf1c075`): B6, B7 + entrega cifrada, pruebas anónimas y B8. La
prueba en vivo sigue `prueba_de_credenciales.md`. Al final: **"Análisis de producto"** (la app
evaluada como si ya estuviera en producción) y **"Mejoras propuestas"**.
Target: Catalyst Hito 5 (2026-10-30).

## Objetivo

- **Problema**: que el **holder** pueda demostrar un predicado sobre un dato privado de su POAP
  (ej. "Región ∈ {EU, US, LATAM}") **sin revelarlo** y sin depender de que el organizador responda
  por él. Hoy solo el organizador puede responder (es el único que tiene `value`/`rand`).
- **Caso de uso**: un tercero le pide al holder que demuestre la veracidad de un dato de su POAP.
  El tercero **no usa la app**: solo pide. El holder genera la prueba y se la **muestra** (pantalla o
  link a la transacción).
- **Respaldo**: los secretos (`value`/`rand` de cada campo) y la clave de identidad `local_sk` hoy
  viven solo en el navegador → respaldo cifrado en Pinata privado, para **ambos roles**.

## Alcance (decidido 2026-09-23)

- **Hasta que lleguen los cambios del backend, NO hay campos únicos por credencial.** Los campos
  privados son **del evento** — iguales para todos los holders, en todas las categorías (Event,
  Follow y Credential). Todo lo de este documento funciona **sin cambios de contrato**.
- **Solo el organizador publica pedidos** ("Ask for a Disclosure"), desde la card expandida de su
  propio evento. Se saca el botón de las cards de evento de Explore (rol subscriber).
- **El subscriber**, desde la card expandida de su POAP: **responde** los pedidos del organizador y
  puede **generar una prueba por iniciativa propia** ("Prove an Attribute").
- **Sin verificación por parte de terceros**: no hay página pública de verificación ni link de
  verificación. El comprobante es algo que el holder muestra.
- **Solo pedidos `Once`** (`proveAttributeMembershipOnce`). Se elimina la variante repetible y la
  elección en la UI.
- **Canal de respuesta = el comprobante (opción a)**: ni el organizador ni un tercero pueden ver
  respuestas on-chain; el holder les muestra/manda el comprobante.

## Lo que se sabe del sistema (verificado en `poap.compact` / indexer)

- `proveAttributeMembership[Once]` **no verifica identidad**: quien conoce la apertura
  `(value, rand)` puede probar. Si el holder tiene la apertura, responde él mismo.
- `publishDisclosureRequest` **no tiene gate**: cualquier wallet publica; el pedido guarda
  `verifier = caller_pk()`. → El holder puede publicar un pedido sobre el evento de su POAP para
  "Prove an Attribute".
- `privateAttributesRoot` se fija una sola vez en `createEvent` (profundidad 8 → máx. 256 hojas).
  **Los atributos son del evento, no del token.**
- **La variante sin `Once` no deja rastro** en el ledger (el indexer no la ve). **`Once` guarda un
  nullifier `hash(local_sk, requestId)`** en `usedDisclosures`, pero **no se puede asociar al
  `requestId`**: el indexer solo sabe que *alguien* respondió *algo*. → Nadie puede contar
  respuestas por pedido; por eso el canal es el comprobante.
- Nullifiers del mismo holder en pedidos distintos **no se pueden correlacionar** (dependen del
  `requestId`) → `Once` no cuesta privacidad.
- `Once` es "una vez por `local_sk` por pedido", no por persona: otra wallet (u otra `local_sk` tras
  perder la anterior) puede volver a responder el mismo pedido.
- `local_sk` vive en el private state del navegador (IndexedDB, `getOrCreatePrivateState`).
  Perderla = el organizador pierde control de sus eventos y el holder deja de ver sus POAPs.
- `private-attribute-drafts.ts`: los secretos del organizador viven solo en `localStorage`.
- `disclosure-response.ts` exige tener los drafts de **todos** los campos del evento para
  reconstruir el árbol → el kit tiene que incluir todas las aperturas del evento.
- `server/` ya tiene `upload-json-private` (Pinata `network: private`) y `private-signed-url`.
- `publishDisclosureRequest.jsx` acepta conjuntos de 1 solo valor (equivale a revelarlo).

## Diseño

### Datos: qué garantiza la prueba y qué no
- Prueba que **quien conoce las aperturas del evento** sabe que el valor ∈ conjunto. **No prueba que
  quien responde tenga el POAP** — eso lo muestra la card del POAP (sello verificado + tx de mint).
  El comprobante muestra las dos cosas juntas.
- Como los campos son iguales para todos, lo que se prueba es un **atributo del evento** ("el evento
  fue en EU"), no un dato personal. El copy de la UI no debe prometer "tu dato personal".

### Organizer — card expandida de su evento (`eventCard.jsx`, `variant="manage"`)
- **"Ask for a Disclosure"** queda solo acá. El pedido siempre es `Once` (sin selector).
- **"Share Attribute Kit"** (nuevo): link con **todas** las aperturas del evento en el fragmento `#`
  (nunca llega a un servidor) para mandar a los holders.
- My Events: la sección "Pending Disclosure Requests" (hoy: el organizador responde) pasa a ser
  **"My Requests"** — listado de las preguntas publicadas, sin conteo de respuestas.

### Subscriber — card expandida del POAP (`poapCard.jsx`)
- **"Disclosure Requests"**: pedidos del organizador sobre ese evento, cada uno con "Respond".
  Si no hay kit importado → "Import kit".
- **"Prove an Attribute"** (nuevo): elegir campo + conjunto de valores → por debajo
  `publishDisclosureRequest` + `proveAttributeMembershipOnce` (**dos firmas**) → comprobante.
- **Comprobante** (al terminar responder o probar, en el mismo popup): la pregunta
  ("Región ∈ {EU, US, LATAM}"), el resultado, el POAP que respalda (evento, sello, tx de mint) y el
  link a la transacción en midnightexplorer.com. Es lo que el holder muestra.
- **Importar kit**: abrir el link del organizador guarda las aperturas en este navegador; la card
  del POAP muestra "Kit imported".
- Se quita "Ask for a Disclosure" de las cards de evento en Explore.

### Respaldo cifrado (ambos roles)
- Contenido: `local_sk` (private state) + drafts del organizador + kits importados.
- Cifrado en el navegador: contraseña → PBKDF2 → AES-GCM (WebCrypto). Nunca texto plano en Pinata
  (privado en Pinata ≠ cifrado de punta a punta).
- Guardado vía `upload-json-private` con etiqueta derivada de wallet **+** contraseña; endpoint nuevo
  en `server/` para obtener el respaldo más reciente por etiqueta.
- Settings: crear / actualizar / restaurar; auto-respaldo al guardar un secreto nuevo si ya hay
  contraseña; descargar el archivo cifrado.

### Visual
- Dark-first, reutilizando los popups centrados (`.drawer-modal`), las cards y el popup único de
  progreso de transacciones (22f3df78). Nada de drawers laterales.

## Decisiones

### Cerradas
- Alcance sin campos únicos por credencial hasta el cambio de backend.
- Solo el organizador pide; subscriber responde + "Prove an Attribute" desde su POAP.
- Sin verificación de terceros; el comprobante es el canal (opción a).
- Solo `Once`.
- ~~Un evento on-chain por credencial~~ — descartado por el usuario.
- **Kit**: el organizador lo comparte manualmente a quien quiera (un link por evento).
- **Respaldo**: contraseña opcional, con aviso persistente mientras no esté configurada.
- **Conjunto**: mínimo 2 valores al pedir / probar.
- **"Prove an Attribute"**: dos firmas aceptadas; el popup de progreso muestra "paso 1 de 2 / 2 de 2".

## Riesgos
- La prueba no queda atada al holder (contrato actual) → comunicarlo en la UI; se resuelve con el
  cambio de backend (ver "Estacionado").
- Respaldo: la contraseña da acceso a la identidad completa; si se olvida, no hay recuperación.
- Corrección criptográfica real solo verificable en vivo contra el devnet (Jest usa hash simulado);
  la prueba en vivo del flujo actual de selective disclosure sigue pendiente.
- `Once` cuesta algo más de DUST que la variante sin rastro (escribe en el ledger).

## Estacionado: campos privados únicos por credencial (espera cambio de backend)

**RESUELTO 2026-09-24** — Matías implementó la opción B (árbol de credenciales, ver "Plan
actualizado"). Se deja esta sección como historia de la decisión.

- **Qué falta**: el árbol de atributos cuelga del evento; para N credenciales distintas hace falta
  un árbol **por token**, fijado en `mintTo`.
- **Opción A** — raíz por token (`tokenPrivateAttributesRoot`) + pedidos dirigidos a un `tokenId` +
  prueba que exige ser el dueño del token. Gana vínculo prueba ↔ holder; el verificador ve qué
  token es.
- **Opción B** — árbol de compromisos (patrón zerocash): el holder prueba sin revelar cuál es su
  credencial. Gana vínculo + anonimato dentro del evento; más complejo, requiere revocación por
  nullifier.
- **Impacto común**: tamaño del contrato (ya hubo deploy por etapas), indexer, redeploy (nueva
  dirección, re-sync de artefactos), `compactc` no disponible en este Windows.
- **UX requerida cuando llegue**: el evento Credential se crea una vez (wizard define solo la
  plantilla de campos); cada emisión desde "Mint" (`mintPoap.jsx`) agrega un paso "Datos privados"
  con los valores del destinatario, una sola firma, y el popup de éxito muestra el kit para el
  destinatario. Evaluar emisión en lote (CSV).
- Recomendación preliminar: B por la historia de privacidad del Hito 5; A si prima el tiempo.

## Encaje con el Hito 5 (evaluado 2026-09-23)
- El criterio 6 pide *"basic proof that caller owns a token"*. Este mecanismo **no** lo cumple (no
  verifica identidad) y **ningún circuito del contrato actual prueba tenencia**. Se le pidió a Matías
  un `proveTokenOwnership(tokenId)` (o equivalente) con prioridad sobre los campos por credencial.
- Este mecanismo, si se construye, se presenta como "selective disclosure de atributos de evento",
  no como prueba de asistencia.

## Qué necesita el backend (irreducible) — pedido a Matías 2026-09-23
El frontend no puede fabricar una prueba de tenencia (está atada a `holder_pk`, derivada de
`local_sk`; ningún circuito actual la verifica sin destruir el token). Hace falta, idealmente en un
solo cambio (≈ opción A):
1. `proveTokenOwnership(tokenId)` → criterio 6 del Hito 5.
2. Raíz de atributos por token en `mintTo` + `proveTokenAttributeMembership` con chequeo de dueño →
   casos por persona.

**Timing**: todo cambio de contrato = redeploy (nueva dirección, nada se migra). Tiene que entrar
**antes del deploy a Mainnet** del Hito 5, o se pierde la evidencia de las 3 wallets.

## Plan por etapas (acordado 2026-09-23)

### A. Operativo hoy (contrato actual)
- **A1. Respaldo cifrado** de `local_sk` + secretos (drafts, kits), y reemplazar la contraseña fija
  del private state (`'AdaSouls-Local-Dev-2026!'` en `providers.ts`). Imprescindible para Mainnet.
- **A2. Flujo de disclosure del holder** con campos a nivel evento (diseño de arriba).
- **A3. Predicados**: ≥, ≤, entre, uno de → se convierten a conjunto (profundidad 16 → hasta 65.536
  valores). Habilita edad / nota / horas CPD sin cambio de contrato.
- **A4. Campos con tipo en la plantilla**: lista, número con mín./máx., fecha/año.

### B. Preparado para el backend (detrás de detección de circuitos)
- **B5. Detección**: `contract.service.ts` consulta `impureCircuits` del módulo compilado; la UI se
  habilita sola cuando llegan los artefactos nuevos.
- **B6. "Prove I Own This POAP"** en la card del POAP, completo salvo la llamada al circuito.
- **B7. Paso "Datos privados" en `mintPoap.jsx`**: valores por destinatario sobre la plantilla del
  evento → raíz por token para `mintTo`.
- **B8. Un solo componente de comprobante** para tenencia / atributo de evento / atributo de token.

### No hacer
- Guardar datos "por persona" anclados al contrato actual (se pierden con el redeploy).
- Presentar A como cumplimiento del criterio 6.

### Orden
1. A1 (respaldo + contraseña del private state) ← **implementado 2026-09-23** (tests + build OK;
   falta prueba manual en devnet, empezando por la migración con una wallet de prueba)
2. B5 + B6 + B8
3. A3 + A4
4. A2 + B7

## Plan actualizado (2026-09-24)

### Qué trajo el backend (`../POAP-Midnight` `4614b96` + `7e65f40`)
- `proveTokenOwnership(requestId, tokenId)` — prueba de tenencia **pública** (revela el `tokenId`),
  atada a un `DisclosureRequest` publicado para el evento del token. Rechaza tokens quemados y a quien
  no es el dueño (`holder_pk(issuer)`). **Cierra el criterio 6 del Hito 5.**
- Árbol `credentials` (HistoricMerkleTree<20>, opción B / patrón zerocash): cada mint escribe
  `credential_leaf(eventId, holder_secret_pk, credAttrRoot)` en el índice `tokenId`.
- `proveEventAttendance(requestId, credAttrRoot, credPath)` — "tengo una credencial vigente de este
  evento" sin revelar cuál.
- `proveCredentialAttribute(requestId, value, rand, attributePath, setMembershipPath, credPath)` —
  lo mismo + predicado sobre un atributo privado **del holder** contra el conjunto del pedido.
- `mintTo(..., credentialAttributesRoot)` — nuevo último argumento (todo ceros = sin atributos);
  `claim()` mintea sin atributos. `burn` invalida la credencial y resetea el historial de raíces.
- Funciones puras `computeCredentialLeaf` / `computeCredentialAttrLeaf`.
- El indexer **no cambió**: no ve estas pruebas (no escriben ledger) ni guarda `credAttrRoot`.
  El `credPath` se saca del estado del contrato con `credentials.findPathForLeaf(leaf)`.

### Estado al cierre del 2026-09-24
- Artefactos resincronizados (contrato, 36 zkir, 36 claves verificadas por SHA256SUMS), `mintTo` del
  servicio con `credentialAttributesRoot` (ceros por defecto). Tests: 306/312, sin regresiones.
- Devnet local reseteada desde génesis → contrato **`44cd94ade4a21488c703e7139df25060ed4880e1a949d9cd852a92966f084ea2`**,
  evento demo en el bloque 73, las 2 wallets refondeadas y generando DUST.
- **Sin probar en vivo todavía**: el mint de credencial con la firma nueva, y la prueba manual de A1.

### Entrega de los datos privados al holder (acordado con Matías 2026-09-24)
Todo off-chain, lo resolvemos nosotros, sin cambios de contrato:
- "Get My Key" (`getHolderKey.jsx`) pasa a incluir una **clave pública de cifrado X25519** junto al
  `holder_pk`, en un solo código. La privada vive en el private state y entra en el backup (A1).
- Al emitir, el navegador del organizador arma el paquete (`value`/`rand`/hojas de cada atributo +
  `credAttrRoot`), lo cifra para esa clave y lo sube a Pinata indexado por `holder_pk` (mismo patrón
  que `/api/backup`).
- My Subscriptions lo busca por el `holder_pk` del holder, lo descifra y lo guarda.
- Respaldo si la clave de holder es vieja (sin clave de cifrado): link con la clave en el fragmento `#`.
- Sensibilidad: los datos revelan el valor, pero **no permiten probar en nombre del holder** (el
  circuito exige `holder_secret_pk`, derivado de su `local_sk`).

### Orden (reemplaza el del 23/09)
1. **B6 — "Prove I Own This POAP"** en la card expandida del POAP (`poapCard.jsx`):
   - `contract.service.ts`: wrapper `proveTokenOwnership(requestId, tokenId)`.
   - Flujo del holder (2 firmas, ya aceptado): `publishDisclosureRequest(label, eventId, 0, 0)` →
     `proveTokenOwnership(requestId, tokenId)`, dentro del popup de progreso único.
   - Flujo con pedido existente: si el organizador ya publicó un pedido, 1 sola firma.
   - Aclarar en la UI que esta prueba **revela qué token es** (para anonimato → paso 4).
   - B5 (detección de circuitos) ya no hace falta: los artefactos llegaron.
2. **B8 — Comprobante**: un solo componente para todas las pruebas (tenencia / asistencia / atributo),
   con tx hash + link a midnightexplorer. Verificación: el indexer propio no las ve → consultar el
   indexer de Midnight (GraphQL `contractAction` por tx, `entryPoint`). Confirmar el campo en vivo.
3. **Clave de cifrado en "Get My Key" + B7** (paso "Datos privados" en `mintPoap.jsx`: valores del
   destinatario sobre la plantilla del evento → `credentialAttributesRoot`) **+ entrega cifrada**.
4. **Pruebas anónimas del holder** desde su POAP: `proveEventAttendance` / `proveCredentialAttribute`
   (con `credentials.findPathForLeaf`), terminando en el comprobante de B8.
5. A3 + A4 (predicados y campos con tipo) — sirven tanto para atributos de evento como de credencial.
6. A2 (kit de atributos a nivel evento) — **reevaluar**: con atributos por credencial puede sobrar.

### Antes de empezar B6 — ✅ hecho 2026-09-24 (A1 y emisión de credencial con `mintTo` probados en vivo)
- Prueba manual rápida: conectar (paso de bienvenida + recovery code nuevo = prueba de A1), crear un
  evento Credential y emitir una credencial con `mintTo` (firma nueva).

### Estado al cierre del 2026-09-24 (noche)
Implementado, con tests (357/362, los 5 de siempre), commit `9cf1c075`, **sin probar en vivo**:
1. ✅ B6 — "Prove I Own This POAP" + "Ask for Proof of Ownership" del organizador (1 firma, sin
   exponer el `caller_pk` del holder).
2. ✅ B8 — comprobante único (`ProofReceipt.jsx`) + `/app/verify` sin wallet (GraphQL del indexer
   de Midnight).
3. ✅ Clave de cifrado en "Get My Key" + B7 + entrega cifrada. Decisiones tomadas:
   - En Credential, el paso de campos privados define solo nombres (`credentialAttributeFields`);
     los valores se cargan por persona en Mint POAP. Event/Follow siguen con valores por evento.
   - La clave X25519 se **deriva** de `local_sk` + organizador (no se guarda; la cubre el backup;
     distinta por organizador). Código: `<holderPk>.<clave>`.
   - Entrega por `server/` → `/api/credential-delivery`; respaldo con link `#fragmento`.
4. ✅ Pruebas anónimas desde el POAP (`proveEventAttendance` / `proveCredentialAttribute`), siempre
   contra pedidos ajenos. Los valores aceptados de cada pregunta se publican en `/api/disclosure-sets`.
5. Pendiente: A3 + A4 (predicados y campos con tipo).
6. A2 (kit a nivel evento): **descartado por ahora** — los campos por credencial cubren el caso.

---

## Análisis de producto (2026-09-24) — la app como si ya estuviera en producción

Supuesto: producto terminado y desplegado en mainnet. Frontend, proxy de Pinata e indexer POAP
alojados por nosotros; los usuarios solo tienen su navegador y su wallet. Lo que es propio del
entorno local (devnet, explorer que no abre, etc.) no cuenta.

### Qué ofrece que no ofrece un POAP en otra cadena
- **Seudónimo por organizador** (`holder_pk`): dos organizadores no pueden cruzar a sus asistentes.
  En un POAP de Ethereum la wallet queda públicamente atada a cada evento.
- **Pruebas anónimas**: "tengo una credencial de este evento" o "mi sector está en esta lista", sin
  decir cuál credencial ni qué wallet.
- **Datos privados por credencial**: la cadena guarda solo la raíz; los valores viajan cifrados y
  nuestro server no puede leerlos.
- **Verificación sin wallet**: quien recibe la prueba abre un link.
- **Revocación**: el emisor puede quemar una credencial y las pruebas dejan de pasar.

Es el argumento de "por qué Midnight" para el Hito 5: todo lo anterior depende de la dualidad
público/privado del contrato.

### Casos de uso reales por tipo de evento

**Event (cualquiera lo reclama: "Attend")**
- Meetups y conferencias como **reputación portable**: "fui a 5 town halls de Catalyst" para entrar
  a un canal de alumni o votar en un grant, con prueba anónima de asistencia. El seudónimo evita
  que se arme un historial de todos los eventos de una persona.
- Talleres y hackatones: "participé" como llave para la siguiente edición o un descuento.
- **No sirve** cuando el POAP da algo de valor (cupos, premios): cualquiera con el link reclama, y
  con varias wallets reclama varias veces (el propio contrato lo documenta).

**Subscription / Follow (membresía continua)**
- Clubes de fans, comunidades pagas, newsletters premium: "soy miembro de X" ante un sponsor, sin
  que el sponsor sepa quién es ni vea sus otras membresías. Es el caso más natural para la prueba
  anónima de asistencia.
- Membresías por temporada, usando el vencimiento del evento.
- **Falta**: niveles y renovaciones (hoy cada nivel sería otro evento).

**Credential (emitida a una persona, con datos privados)** — donde está el mayor valor
- **Entradas con asiento**: tenencia en la puerta, "sector ∈ {Campo}" para una zona, revocación
  por reventa o reembolso.
- **Títulos y certificados**: "me recibí en X" y "nota ∈ {A, B}" ante un empleador, sin mostrar
  nombre ni el resto del certificado; recursos humanos verifica con el link.
- **Matrículas y licencias profesionales**: "matrícula vigente" sin dar el número; si se revoca,
  las pruebas dejan de pasar.
- **Credenciales de empleado / control de acceso**: "área ∈ {Ingeniería, Operaciones}" para entrar
  a un piso sin registrar quién entró.
- **Edad o residencia** emitidas por alguien de confianza (club, municipio), hoy por categorías.
- En todos, la confianza está en el emisor: la prueba dice "X certificó esto", no que el dato sea
  cierto en el mundo. Para títulos, entradas y licencias es justo lo que se quiere.

**Atributos a nivel de evento (Event / Follow)**
- Prueban cosas del evento ("fue en la UE"), no de la persona. Sirven sobre todo para reportes a
  sponsors. Es lo primero que simplificaría si hay que recortar alcance.

### Límites del producto terminado (lo que vería un usuario real)
1. **Dónde se generan las pruebas — DECIDIDO 2026-09-24: proof server alojado por nosotros
   (con Matías).** No es local de cada usuario (Docker es imposible para el público y no existe en
   el celular). El proving "de la wallet" tampoco era alternativa: en agosto `getProvingProvider()`
   de Lace mandaba los datos al servidor remoto de Midnight (ver comentario en `providers.ts`).
   Consecuencia: **el operador del proof server ve en claro los datos privados de cada prueba** —
   la `local_sk` de cada usuario (con ella podría calcular sus seudónimos por organizador) y los
   valores de las credenciales que se prueban. La cadena y los demás usuarios siguen sin ver nada;
   la privacidad pasa a depender de confiar en AdaSouls. Requisitos para que sea aceptable:
   - sin registros de los cuerpos de los pedidos (solo métricas);
   - HTTPS y CORS limitado a nuestro dominio;
   - control de abuso (límite por IP o token de sesión): probar es caro en CPU;
   - capacidad para picos (cientos de pruebas a la vez en una puerta);
   - a futuro, correrlo en un entorno aislado (TEE / confidential computing) para que ni nosotros
     podamos leer los datos;
   - ajustar textos que prometen más de lo que se cumple frente al operador ("Only you can see
     these", "your wallet is not revealed") o explicarlo en la política de privacidad.
2. **Intercambio de claves a mano.** Para emitir una credencial, holder y organizador se pasan
   claves por fuera de la app (chat, mail). Con una persona se tolera; con cien entradas no.
3. **Pruebas sin momento.** Un pedido se puede reutilizar y la verificación no lee los argumentos,
   así que un comprobante viejo se puede volver a mostrar. En una puerta, alguien podría presentar
   la prueba de otro. Falta que el verificador genere un pedido nuevo en el momento.
4. **Nada se "consume".** No hay prueba de un solo uso para tenencia o asistencia: sirve para
   demostrar, no para validar una entrada una sola vez.
5. **Reclamo abierto en eventos públicos — es a propósito (decidido 2026-09-24).** Cualquiera
   puede reclamar un Event o Follow; no se van a agregar códigos de reclamo.
6. **Solo "está en esta lista".** Sin rangos ni comparaciones (A3): "edad ≥ 18" se resuelve con
   categorías.
7. **El anonimato depende del tamaño del evento.** Con pocas credenciales emitidas, "alguien de
   este evento" identifica a la persona. La interfaz no lo advierte.
8. **Cada prueba es una transacción.** Cuesta DUST y tarda lo que tarde la red; el verificador
   espera la confirmación.
9. **Recuperación.** Si el usuario pierde el navegador y el recovery code, pierde su identidad en
   el contrato: sus POAPs siguen existiendo pero ya no puede probar que son suyos.
10. **Servicios propios en el medio.** Si el proxy de Pinata o el indexer POAP caen, la app no lista
    ni entrega nada (los tokens siguen en la cadena). El proxy ve metadatos: quién sube, cuándo y
    con qué `lookupId`, aunque no el contenido.
11. **Onboarding de wallet.** Instalar Lace o 1am, tener NIGHT, generar DUST y esperar la
    sincronización antes de la primera firma: es la barrera de entrada más alta para el público
    general, y no depende de nosotros.

---

## Mejoras propuestas (orden sugerido, después de la prueba en vivo)
**Plan acordado 2026-09-24:** todas estas entran en el MVP. Se construyen en un día de trabajo, se
validan al día siguiente, cerrando esta semana, y el lunes 2026-09-28 se empieza en preprod. La 1
depende de la infraestructura con Matías; el lado frontend es solo apuntar la URL.

1. **Proof server de producción** (límite 1; infraestructura con Matías). En el frontend alcanza con
   apuntar `REACT_APP_MIDNIGHT_PROOF_SERVER_URL` a la URL alojada; el trabajo está en el servidor
   (sin logs, CORS, límites, escala) y en ajustar los textos de privacidad. El local queda solo
   para desarrollo.
2. **QR para el intercambio de claves** (límite 2). El holder muestra un QR o un link con su código;
   Mint POAP lo lee y rellena el destinatario.
3. **A3 — rangos y comparaciones** (límite 6), y A4 — campos con tipo (fecha, número).
4. **Aviso de anonimato** (límite 7): mostrar cuántas credenciales vivas tiene el evento antes de
   una prueba anónima.
5. **Validez / vencimiento** (sumada al MVP 2026-09-24). Solo frontend.
   Un campo opcional **"Validity"** en el evento (horas, días, meses, años o sin vencimiento) que el POAP
   cruza con una fecha para mostrar **"Active until …"** o **"Expired"**. Según la categoría, el plazo
   se cuenta desde una fecha distinta:

   - **Subscription: desde la última prueba de tenencia.** Tener el POAP no te hace suscriptor activo;
     probarlo cada tanto sí. El suscriptor renueva cuando quiere, probando de nuevo (una transacción,
     con costo de DUST). Es una señal de confianza, no un control de pago. El organizador conserva el
     corte: si quema el POAP, ya no se puede volver a probar y queda vencido. Funciona también con la
     prueba anónima, porque la validez es del evento y no del token. Base ya hecha: el historial de
     pruebas (`proof-history.ts`).
   - **Credential (matrícula médica por N años, licencia de conducir por 5): desde la emisión.** El
     holder no puede autorrenovarse: renueva el emisor, que emite una credencial nueva; puede revocar
     antes quemándola. La hora de emisión sale del `mintedBlock` del token y la hora del bloque del
     indexer de Midnight.

   Piezas: campo en el asistente y la metadata; badge en el POAP; vigencia de cada prueba en el
   historial; y en `/app/verify`, "valid until … / expired". Esto último necesita leer de la
   transacción el pedido (`requestId`), que dice de qué evento es, para que no se pueda falsificar
   pasando otro evento por la URL.
6. **Revocar (burn)** (sumada al MVP 2026-09-24). El contrato ya tiene `burn(tokenId)` (lo puede
   llamar el dueño, el organizador/emisor del evento o el admin) y `PoapContractService.burn()`
   existe en `contract.service.ts`, pero ningún botón lo llama (el "Burn" de
   `collection-details.jsx` es del camino viejo de Cardano). Falta: botón "Revoke" en la lista de
   suscriptores del organizador (`subscribersList.jsx`) y, quizás, "Burn" para el propio holder en
   su POAP. La UI ya muestra los tokens quemados. Es la contraparte de la Validez: con ella el
   organizador corta una Subscription y el emisor revoca una Credential antes de tiempo.

### Diseño acordado 2026-09-24 (brainstorm de las mejoras 2 a 6)

**Estado: implementado 2026-09-24 (noche), sin commitear, sin probar en vivo.** Tests 421 pasan (los
5 de siempre fallan). Guía de validación desde cero: `prueba_de_credenciales.md`. Queda del lado de
Matías la mejora 1 (proof server alojado).

**QR / links (2).** Circuito de dos links, ambos con los datos después del `#`:
- El organizador comparte un **link de invitación** desde la card de un evento Credential
  (`/app/key#organizer=…&event=…`, con QR). Al abrirlo, el fan ve Get My Key con la clave del
  organizador cargada y el código generado solo.
- Get My Key devuelve un **link de emisión** con QR (`/app/mint#event=…&to=<código>`). Al abrirlo, el
  organizador ve Mint POAP con el evento y el destinatario cargados, o un aviso si la wallet no es la
  del organizador.
- Pegar a mano sigue funcionando. Librería: `qrcode.react`. Sin escáner propio: se escanea con la
  cámara del celular.

**A3 + A4 (3), solo Credential.**
- Tipos de campo: Texto, Número (**solo enteros**, mín./máx. opcionales), Fecha (`YYYY-MM-DD`) y Lista
  (opciones fijas).
- Mint POAP usa el control de cada tipo, con codificación canónica.
- Ask for a Disclosure pregunta según el tipo:
  - Texto o Lista: "uno de".
  - Número: ≥, ≤, entre, uno de.
  - Fecha: antes, después, entre, y el atajo "al menos N años".
- Un rango se expande a la lista de valores que lo cumplen (máximo 65.536). Se publica la **regla**,
  no la lista, y cada navegador la expande. El árbol se arma por partes, con progreso.

**Aviso de anonimato (4).** Siempre se muestra "Anonymous among N holders of this event" (N = tokens
vivos). Con **menos de 5**, además un aviso ámbar, sin bloquear el botón.

**Validez (5).** Campo "Validity" opcional en el asistente, para todas las categorías (cantidad +
unidad, o sin vencimiento), guardado en la metadata del evento.
- Subscription: "Active until" = última prueba + plazo, en el POAP y en `/app/verify`.
- Event y Credential: se cuenta desde el minteo.
- **Opción (b):** una Credential con validez recibe automáticamente un campo privado **"Valid until"**
  (tipo Fecha), así el verificador puede preguntar anónimamente "Valid until ≥ hoy" con los rangos
  de la mejora 3.

**Revocar (6): ambos.** "Revoke" para el organizador en la lista de suscriptores, y "Burn" para el
holder en su propio POAP. Los dos piden confirmación.

Para la demo del Hito 5 alcanza con el flujo de Credential (recital o título) tal como está; las
mejoras son las que separan la demo de un piloto con usuarios reales.


---

## Ideas para más adelante (2026-09-24, conversadas, sin diseñar)

### Pedidos en el momento (fuera del MVP, decidido 2026-09-24)
**Pedidos en el momento** (límites 3 y 4). Una pantalla de verificador: genera un pedido nuevo,
muestra un QR, el holder responde a ese pedido y la pantalla se actualiza sola al confirmarse.
Para "un solo uso" haría falta una variante de tenencia con nullifier en el contrato (pedido a
Matías).

### Hecho 2026-09-24: sin atributos privados en Event y Subscription
En esas categorías los atributos privados eran del evento (mismo valor para todos) y solo los
respondía el navegador del organizador, así que una pregunta sobre ellos no decía nada del holder.
Tampoco le llegaban al que reclamaba. Se quitó: el paso del asistente (queda solo en Credential),
"Ask for a Disclosure" en esos eventos, "Pending Disclosure Requests" en My Events, la página
`/app/disclosure/respond`, `disclosure-response.ts` y `private-attribute-drafts.ts` (y su lugar en el
backup). El contrato no cambió; `/app/verify` sigue reconociendo pruebas viejas de
`proveAttributeMembership`. Los Prove (tenencia y tenencia anónima) siguen en todas las categorías.

Idea abierta que salió de esto: **contenido privado para quienes reclamaron** un Event o
Subscription (un link, un código de descuento), visible solo para cada wallet holder. Hoy no existe.
Para un descuento, un código compartido no se puede comprobar (quien lo sabe lo usa). Mejor que el
POAP sea el descuento: la tienda pide Prove Ownership Anonymously. Para que sea seguro faltan
"Pedidos en el momento" (sin reusar pruebas viejas) y un nullifier en el contrato (un uso por
holder). Alternativa sin contrato: un código distinto por holder, entregado cifrado. Decidido
2026-09-24: queda para después del MVP.

### Resiliencia (fuera del MVP, decidido 2026-09-24)
Varios gateways de IPFS y un modo de solo lectura cuando el indexer POAP no responde (límite 10).
No es obligatorio para la presentación del MVP.

### Solo por invitación y check-in de N horas
Relacionado con la Validez (mejora 5): habilitar **"solo por invitación"** también en Event y
Subscription (hoy solo existe en Credential), para membresías pagas donde renueva el organizador.
Y la ventana de N horas desde la
entrada a un evento, con renovación, necesita un check-in de un solo uso en el contrato (a
conversar con Matías).

### "Ask for Proof of Ownership" automático
Hoy es un paso manual del organizador. Si lo olvida, sus holders no tienen prueba anónima de
tenencia, y Prove Ownership les pide 2 firmas y vincula su wallet con el token. Opciones: publicarlo
automáticamente al crear el evento (una firma más en ese momento), o al menos un aviso en la tarjeta
del evento mientras no esté publicado.

### "Ask for a Disclosure" desde la creación del evento
No es obsoleto frente a los datos privados del POAP: los datos privados son la **respuesta** del
holder y el pedido es la **pregunta**. El circuito prueba "mi valor comprometido está en el conjunto
publicado", así que sin un pedido on-chain no hay nada contra qué probar (y el `requestId` ata la
prueba a esa pregunta en el comprobante y en `/app/verify`). Lo que sobra es el paso manual
posterior. Opciones:

- En el paso de campos privados de Create Event (Credential), marcar los **valores aceptados** de
  cada campo y publicar esas preguntas automáticamente al crear (una firma por pregunta). "Ask for a
  Disclosure" queda para preguntas nuevas.
- Como mínimo, un aviso en la tarjeta del evento cuando hay campos privados pero ninguna pregunta
  publicada (hoy el holder ve "Nobody has asked a question…" y no puede hacer nada).

Conviene resolverlo junto con el "Ask for Proof of Ownership" automático de arriba: mismo momento,
mismo patrón.

---

# Brainstorm — Pedidos de verificación dirigidos (2026-10-02)

Estado: **diseño preliminar, sin implementar.** El usuario lo va a conversar con Matías para ver si
hace falta.

## Objetivo

Un **verificador** externo pide una prueba sobre una credencial y se la pide a una persona puntual.
Ejemplo: un posgrado le pide a un postulante que pruebe "nota ≥ 8" de su diploma de la UTN.

- El **organizador** (la UTN) queda afuera del flujo: solo emitió la credencial.
- Aplica **solo a credenciales** (categoría Credential, con datos privados).
- No hay fecha límite.

## Lo que se sabe del sistema (verificado en `poap.compact` d1e2a1f y en el frontend)

- `publishDisclosureRequest(label, eventId, fieldId, setRoot)` **no tiene control de quién llama**.
  Cualquier wallet puede publicar un pedido sobre cualquier evento, y queda como `verifier`. El
  pedido se ata al **evento**, no a una persona.
- El holder ve **todos** los pedidos del evento de su credencial. `listAnswerableRequests` en
  `holder-proofs.ts` filtra solo por `eventId`, sin importar quién los publicó, y no hay
  notificaciones.
- Hoy "Ask for a Disclosure" solo aparece en la tarjeta del evento, y las credenciales no se listan en
  Explore. En la práctica, un tercero no puede publicar un pedido desde la interfaz aunque el contrato
  se lo permita.
- `proveCredentialAttribute` prueba "alguna credencial viva de este evento tiene ese valor en el
  conjunto", **sin revelar ni el token, ni el holder, ni el valor**.
- **No hay variante de un solo uso para credenciales.** `proveAttributeMembershipOnce` (con
  nullifier) existe solo para los atributos a nivel evento, que ya se quitaron de la app.
- **Hallazgo clave: no se puede atar la respuesta al postulante con el contrato actual.** La prueba
  anónima no dice qué credencial la respondió. Sumar "Prove Ownership" (que muestra el número de
  token) es una prueba **separada**: no demuestra que la nota ≥ 8 sea de ese mismo token. Un
  postulante con nota 6 podría pedirle a un compañero con nota 9 que responda su pedido.

## Dónde va en la app

No en Organizer: verificar es otro rol. Propuesta: que **`/app/verify` pase a tener dos partes**:

- **"Ask for proof"** (nuevo, requiere wallet porque publicar es una transacción).
- **"Check a proof"** (lo que existe hoy, sin wallet).

Se entra desde el nav (por ejemplo, un link "Verify") y desde el launcher. No hace falta un tercer
rol en el switch de la barra inferior.

## Diseño preliminar

### Datos (público / privado)
- On-chain (público): el pedido (evento, campo, raíz del conjunto) y quién lo publicó. Igual que hoy.
- El texto de la condición ("Nota ≥ 8") se publica en IPFS como hoy (`publishRequestRule`).
- La respuesta sigue siendo anónima: el verificador ve "válido", la condición y el emisor (con badge
  Verified si corresponde). Nunca ve la nota ni la wallet.
- **No prometer** "solo esta persona puede responder": no es cierto con el contrato actual (ver
  hallazgo). La interfaz tiene que decir "le pediste la prueba a esta persona", no "solo ella puede
  responder".

### Flujo
1. **Cómo encuentra el verificador la credencial:** el postulante comparte, desde su credencial, un
   link "Share for verification" con el evento (sin token ni wallet). Alternativa: el verificador
   busca al emisor por nombre o clave entre los eventos del indexer (incluye los Credential que no
   están en Explore).
2. **El verificador arma el pedido** con el formulario que ya existe (`QuestionBuilder`, condiciones
   por tipo de campo) y obtiene un **link + QR** (mismo patrón que Invite Link) para mandarle solo al
   postulante.
3. **El postulante abre el link** y ve ese pedido en "Prove a Private Detail" de su credencial. Si su
   valor no califica, el botón queda deshabilitado, como hoy.
4. **Responde** y le manda el comprobante al verificador, que lo valida en "Check a proof".

### Visibilidad dirigida (solo frontend)
- La lista del holder muestra **solo los pedidos que abrió con un link**, más los "Ask for Proof of
  Ownership" del propio organizador. Los pedidos abiertos se guardan en el navegador y van en el
  backup cifrado.
- Es una restricción de **interfaz**: el pedido sigue en la blockchain y alguien con conocimientos
  técnicos podría responderlo.

### Frontend
- `/app/verify`: pestañas "Ask for proof" y "Check a proof".
- Reutiliza `publishDisclosureRequest.jsx` (y `QuestionBuilder`) fuera de la tarjeta del evento.
- Reutiliza `LinkQrCard` para el link y el QR del pedido.
- Nuevo en la credencial del holder: "Share for verification".
- Cambia `listAnswerableRequests`: filtra por pedidos abiertos desde un link.
- Estilo: el mismo de los popups y las tarjetas actuales (oscuro, vidrio).

## Decisiones abiertas (para después de hablar con Matías)

1. ¿Hace falta esta funcionalidad, o alcanza con que el organizador publique las preguntas?
2. ¿Cómo encuentra el verificador la credencial: link compartido por el postulante, búsqueda del
   emisor, o las dos?
3. ¿La lista del holder pasa a mostrar solo los pedidos abiertos desde un link? Esto cambia el
   comportamiento actual para todos.
4. ¿Se acepta el riesgo de que un compañero responda por el postulante, o se pide el cambio de
   contrato de abajo antes de lanzarlo?

## Qué necesitaría el backend (para la garantía fuerte)

Para atar la respuesta al postulante, cualquiera de estas variantes es un cambio de contrato:

- **Pedido dirigido:** el pedido guarda un destinatario (por ejemplo, el `holder_pk` para el emisor
  de esa credencial) y `proveCredentialAttribute` exige que quien responde sea ese destinatario. El
  verificador necesita conocer ese valor, que el postulante le pasa en el link.
- **Un solo uso para credenciales:** una variante `proveCredentialAttributeOnce` con nullifier por
  (credencial, pedido), para que un pedido dirigido no pueda responderse varias veces.

Sin esto, el diseño de arriba sirve como **comodidad** (la pregunta le llega a quien corresponde),
no como **garantía**.

## Riesgos

- Sobreprometer privacidad o exclusividad en la interfaz (ver hallazgo clave).
- Cambiar la lista del holder puede ocultar preguntas que el organizador publicó para todos. Por eso
  se mantienen visibles las del propio organizador.
- Los links del pedido se pueden reenviar; no son secretos.

## Próximo paso

Si Matías confirma que hace falta: cerrar las decisiones 1–4 y pasar a Plan mode para la
implementación. Si se pide la garantía fuerte, esperar el cambio de contrato antes de lanzarlo.

---

# Brainstorm — Documentos de identidad en credenciales + pedidos de actualización (2026-10-07)

Estado: **diseño cerrado 2026-10-07, sin implementar** (próximo paso: Plan mode). Contrato ya sincronizado (backend `0e37df6`, preprod
`fadfffae…152a`, rama `chore/contract-identity-documents`). Fuente: flujos 12 y 13 de
`docs/01-contract/circuits.md` en `AdaSouls/velum` develop `ec318ef`, y charla con Matías del 07/10.

## Objetivo

- **Evitar el préstamo de credenciales.** Hoy un postulante con nota 6 puede darle al verificador la
  clave de un compañero con nota 9, y el compañero responde. Con un documento de identidad dentro de
  la credencial, el verificador comprueba que la credencial es de la persona cuyo documento tiene
  delante.
- **Actualizar la credencial** cuando cambia el documento: el holder le pide al emisor que la vuelva
  a emitir.
- Solo credenciales. **Opcional**: una credencial puede no tener documentos, o tener uno o varios.

## Lo que se sabe (contrato + charla con Matías)

- `computeIdentityValue(country, docType, number, salt)` es una función local, sin transacción.
  Entradas: país ISO alpha-3 (`ARG`), tipo (`national_id`, `passport`…) y número en mayúsculas sin
  separadores, cada uno rellenado a 32 bytes; `salt` son 32 bytes aleatorios distintos de cero. El
  resultado se guarda como un atributo más de la credencial, con su propio `fieldId`.
- El **salt (código de identidad)** es imprescindible. La raíz del conjunto de cada pedido es
  pública; sin salt, los números de documento se podrían adivinar por fuerza bruta.
- El verificador comprueba el documento físico y le pide al holder el código. Con eso calcula el
  mismo valor y publica un **pedido dirigido** cuyo conjunto tiene solo ese valor.
- **Dos pedidos, dos pruebas, dos firmas.** Uno para la identidad y otro para la condición real
  (p. ej. nota ≥ 8), los dos dirigidos al mismo seudónimo. Como un holder tiene una sola credencial
  por evento, las dos pruebas son sobre la misma credencial. Matías dijo "todo en una misma acción":
  se puede sentir como una sola acción en la interfaz, pero la wallet firma dos veces (confirmado
  con Matías).
- Actualización: `requestCredentialUpdate(tokenId, payloadCommit)` lo llama el dueño del token.
  Pedirla de nuevo reemplaza el pedido anterior. El contenido viaja cifrado al emisor fuera de la
  cadena; on-chain solo queda que se pidió y cuándo. El emisor puede cerrarlo con
  `dismissCredentialUpdate`, o con `burn` + `mintTo` al mismo seudónimo (el `burn` también cierra el
  pedido). Indexer: `/api/credential-update-requests?issuerPk=…&status=pending`.

## Diseño preliminar

### Datos (público / privado)
- On-chain: solo el valor con hash y salt, dentro del árbol de la credencial (no se ve). El pedido de
  identidad (dirigido) es público: se ve que *alguien* preguntó por un campo de identidad a ese
  seudónimo, pero no qué documento.
- **No publicar** la regla del pedido de identidad en `/api/disclosure-sets`: el holder verifica
  localmente que su valor coincide con la raíz del conjunto (un solo elemento).
- Los pedidos de actualización son públicos en cuanto a su existencia. La interfaz tiene que avisarle
  al holder: "cualquiera puede ver que pediste una actualización, no qué cambió".
- No prometer más de lo que da: sirve si **el emisor comprobó el documento antes de emitir** y **el
  verificador comprueba el del postulante**.

### El perfil (decidido 2026-10-07)
El perfil **no sirve como prueba de identidad**: lo completa el propio dueño de la wallet, se puede
editar y nadie lo comprueba. El préstamo ocurre justamente porque una wallet no es una persona. Sirve
como comodidad:
- **Perfil del organizador** → guarda su **clave pública de cifrado** para recibir pedidos de
  actualización. Viaja en la metadata pública de sus eventos o credenciales, y el holder la usa para
  cifrar el pedido (mismo esquema que `credential-crypto.ts`, en sentido inverso).
- **Datos de identidad del holder (privados, nunca publicados)** → en el navegador: documentos y
  código de identidad de cada credencial. Entran en el backup cifrado (`BACKED_UP_PREFIXES`). Sirven
  para completar solos el link para el verificador y el formulario de actualización.
- El organizador **no** usa el perfil para esto: el documento del destinatario lo tipea él, a partir
  del documento que comprobó.

### Frontend (borrador)
- **Emisión (`mintPoap.jsx` + `PrivateAttributesStepFields`):** tipo de campo nuevo "Documento de
  identidad". Al emitir se genera el salt, se calcula `computeIdentityValue` y el salt va al holder
  junto con los demás datos privados (entrega cifrada existente).
- **Holder, en su credencial:** el documento se muestra enmascarado (`ARG · DNI · ••••5678`), junto
  con el código de identidad y la opción de copiarlo o compartirlo.
- **Verificador (`publishDisclosureRequest.jsx` / `QuestionBuilder`):** condición "Identidad" donde
  ingresa el número que ve en el documento y el código. La app calcula el valor y publica el pedido
  dirigido.
- **Holder responde (Prove a Private Detail):** si hay pedido de identidad + pedido de condición del
  mismo verificador, un botón "Responder" que encadena las dos pruebas (dos firmas, avisado antes).
- **Actualización:**
  - Holder: "Pedir actualización" en la credencial → elige documento y escribe el dato nuevo → se
    arma un sobre cifrado al organizador con el paquete actual + los cambios + su propia clave de
    cifrado → se sube por un endpoint nuevo de `server/` → `requestCredentialUpdate` con
    `payloadCommit = sha256(sobre)`.
  - Organizador: lista de pedidos pendientes → verifica que el paquete viejo coincide con la cadena →
    "Rechazar" (`dismissCredentialUpdate`) o "Reemitir" (`burn` + `mintPoap` precargado).
- Estilo: el de los popups y tarjetas actuales (oscuro, vidrio, sin bisel).

## Decisiones (cerradas 2026-10-07)

1. **País y tipo de documento los fija el organizador por campo** (p. ej. "DNI Argentina"). Al emitir
   solo se escribe el número.
2. **El link para el verificador incluye el código de identidad, nunca el número.** El verificador
   escribe el número que ve en el documento físico. Va después del `#` (no llega a ningún servidor),
   extendiendo el link existente `/app/request#…&to=…`. No debilita la protección: con el código de
   otra persona el valor no coincide. Si se filtra el link, alguien que sepa el DNI puede relacionar
   esa credencial con la persona, pero no responder por ella; cada credencial tiene su propio código.
   La pantalla de compartir avisa: "Este link es personal: dáselo solo al verificador".
3. **Un solo popup "Pedir prueba"** publica los dos pedidos (identidad + condición), y del lado del
   holder **un solo "Responder"** encadena las dos pruebas (dos firmas, avisado antes).
4. **Reemitir hace todo, en etapas guiadas:** revisar el pedido → quemar la credencial vieja →
   emitir la nueva con `mintPoap` precargado (datos anteriores + documento nuevo). Hay que prever
   retomar si se corta entre la quema y la emisión.
5. **Alcance: todo** (identidad + actualización), apuntando al Hito 5 (vence 2026-10-30).
6. **Confirmado con Matías:** "una misma acción" son dos pruebas y dos firmas.

## Riesgos
- Prometer de más en la interfaz: no prueba quién es la persona, solo que el documento coincide con
  el que el emisor cargó.
- Si se filtra el código de identidad junto con el DNI, cualquiera puede comprobar esa credencial
  (pero no responder: responder sigue necesitando la clave del holder).
- Los pedidos de actualización dejan un rastro público (se ve que se pidió y cuándo).
- El endpoint nuevo en `server/` para los sobres de actualización es infraestructura nueva.

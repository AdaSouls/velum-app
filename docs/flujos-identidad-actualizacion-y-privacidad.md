# Velum: identidad en credenciales, pedidos de actualización y preguntas de vencimiento

**Para:** Matías · **De:** Mauro (frontend `AdaSouls/velum-app`) · **Fecha:** 2026-10-07
**Contrato:** `AdaSouls/velum` develop `ec318ef` (`0e37df6`), preprod `fadfffae…152a`
**Estado:** implementado en la rama `chore/contract-identity-documents`, todavía sin probar en vivo.

Este documento explica cómo usa el frontend los circuitos nuevos (`computeIdentityValue`,
`requestCredentialUpdate`, `dismissCredentialUpdate`): qué hace cada persona, qué viaja por dónde y
quién puede ver cada dato. Al final hay una lista de cosas para que revises.

---

## 1. Resumen

| Qué | Para qué | Circuitos |
|---|---|---|
| Documento de identidad en la credencial | Que nadie pueda responder con la credencial de un amigo | `computeIdentityValue` (local), `mintTo`, `publishDisclosureRequest`, `proveCredentialAttribute` |
| Control de identidad + pregunta | El verificador pide las dos cosas a la vez; el holder responde con un solo botón | 2 × `publishDisclosureRequest`, 2 × `proveCredentialAttribute` |
| Pedido de actualización | Si cambia el documento, el holder pide la reemisión | `requestCredentialUpdate`, `dismissCredentialUpdate`, `burn` + `mintTo` |
| Preguntas de vencimiento en palabras simples | "¿Sigue vigente?", "¿vence en menos de 6 meses?" | `publishDisclosureRequest`, `proveCredentialAttribute` (rangos de fecha) |

Todo sigue tu documentación (flujos 12 y 13 de `docs/01-contract/circuits.md`). Ningún cambio
necesita tocar el contrato.

---

## 2. Documento de identidad en la credencial (flujo 12)

### 2.1 El organizador crea el evento
- En los campos privados de un evento Credential hay un tipo nuevo: **Identity document**.
- El organizador **fija el país (ISO alpha-3) y el tipo de documento** del campo: `national_id`,
  `passport`, `tax_id` o `residence_permit`.
- En la metadata pública del evento queda la plantilla:
  `{ fieldId, label, type: "identity", country: "ARG", docType: "national_id" }`.
  Ese `fieldId` es el mismo que después usan los pedidos.

### 2.2 El organizador emite la credencial
1. Escribe el número del documento que comprobó.
   - Se normaliza: mayúsculas, sin espacios, puntos, guiones ni barras.
   - Hasta 32 caracteres, solo letras y dígitos.
2. El navegador genera un **salt** de 32 bytes aleatorios (nunca cero) y calcula
   `computeIdentityValue(pad32(country), pad32(docType), pad32(number), salt)`.
3. Ese valor entra como un atributo más del árbol de la credencial
   (`computeCredentialAttrLeaf(fieldId, value, rand)`), con su propio `rand`. Después se llama a
   `mintTo` como siempre.
4. El paquete privado que recibe el holder lleva, para ese campo, el valor con hash y además
   `identity: { country, docType, number, saltHex }`. Viaja cifrado por la misma vía que el resto
   de los datos privados (X25519 → AES-GCM, `/api/credential-delivery`).

Para el holder, el salt es el **código de identidad**. Cada credencial tiene el suyo, y una
reemisión genera uno nuevo.

### 2.3 El holder
- En su credencial ve el documento enmascarado (`National ID · ARG · ••••5678`) y su código, con un
  botón para copiarlo.
- El **link para que le pregunten** (`/app/request#event=…&to=<holderPk>&id=<fieldId>.<salt>`) lleva
  el código de cada documento, **nunca el número**.
  - Va después del `#`, así que el navegador no lo manda a ningún servidor.
  - La app avisa: "este link es personal, dáselo solo a quien compruebe tu documento".

### 2.4 El verificador pide la prueba
En "Ask for a Disclosure", si la credencial tiene documentos, aparece **Identity check**:
1. Escribe el número del documento que tiene delante.
2. El código ya viene completo si abrió el link del holder.
3. Puede sumar la pregunta real (por ejemplo "Nota ≥ 8"), pedir solo identidad o solo la pregunta.
4. Al publicar se hacen **dos transacciones seguidas** (dos firmas), las dos dirigidas al mismo
   `holderPk`:
   - **Identidad:** el conjunto tiene **un solo valor**, el `computeIdentityValue`, en un árbol de
     profundidad 16. En `/api/disclosure-sets` se publica solo `{ "op": "identity" }`: el tipo de
     pregunta, no el número.
   - **Pregunta:** igual que antes (la regla de texto, número o fecha).

### 2.5 El holder responde
- Su navegador comprueba en local que su propio valor reconstruye la raíz del pedido de identidad.
  Si no coincide (otro DNI u otro código), el botón queda desactivado con el aviso "no coincide con
  el documento de tu credencial".
- Los pedidos del mismo verificador se **agrupan**: identidad + pregunta aparecen juntos con un
  botón **Respond**, que hace las dos `proveCredentialAttribute` seguidas ("1 of 2", "2 of 2").
  Termina con un comprobante por cada prueba.
- Como un holder tiene una sola credencial por evento, las dos pruebas son sobre la misma
  credencial, tal como dice tu documentación.
- Al terminar, además de un comprobante por prueba, le damos **un solo link que verifica las dos
  juntas** (`/app/verify?tx=<identidad>,<pregunta>`), para que se lo mande al verificador.

### 2.6 La página pública de verificación
- `/app/verify` muestra la prueba de identidad como "DNI (National ID · ARG) matches the document
  checked". Esa página **no puede confirmar cuál** documento era, porque el número no se publica.
  Eso lo sabe solo quien pidió la prueba.
- **Varias pruebas en un link** (`?tx=a,b`): la página verifica cada una y arriba muestra un resumen:
  si todas son válidas, si las respondió el mismo holder (todas las pruebas de atributos van dirigidas,
  así que el `recipientPk` sale de la transacción) y si el control de identidad está.
- **Falta la prueba de identidad:** para cada respuesta a una pregunta, la página busca en el indexer
  si el mismo verificador le mandó al mismo holder, sobre el mismo evento, un pedido de identidad
  (`/api/disclosure-requests?verifierPk=…`, filtrando por `eventId`, `recipientPk` y un `fieldId` de
  tipo identity). Si existe y su prueba no está en la página, muestra en rojo "Identity proof
  missing".
  - Esto cubre el caso de préstamo: el compañero **puede** responder la pregunta (va dirigida a su
    clave), pero no la de identidad.
  - Sin el aviso, un verificador distraído podría aceptar solo la respuesta.

### 2.7 El control de identidad viene obligatorio
En el popup del verificador, si la credencial tiene documento, el control de identidad viene
activado. Para apagarlo hay que confirmar explícitamente ("I understand, ask without it"), con un
aviso de que sin él cualquiera a quien el holder le preste su clave podría responder.

---

## 3. Pedido de actualización (flujo 13)

### 3.1 La clave del organizador para recibir pedidos
- Cada identidad de organizador tiene una clave X25519 **derivada de su `local_sk`**:
  `seed = SHA-256("velum:issuer-inbox-key:v1:" ‖ local_sk)`.
  - No hay que guardar nada nuevo: es la misma en todos los navegadores y vuelve con el backup.
  - El dominio propio la separa de las claves de entrega por organizador.
- Al crear un evento **Credential**, su clave pública se publica en la metadata como
  `updateRequestKey`.
- Los eventos creados antes de este cambio no la tienen, así que sus holders no pueden pedir
  actualizaciones. En preprod no importa, porque `fadfffae…` arrancó vacío.

### 3.2 El holder pide la actualización
1. Botón **Request Update** en su credencial: aparece si la credencial tiene un documento y el
   evento tiene `updateRequestKey`.
2. Elige el documento y escribe el número nuevo, más un motivo opcional (hasta 280 caracteres).
   Tiene que ser distinto del número actual.
3. El navegador arma el pedido:
   ```json
   {
     "kind": "velum-credential-update", "version": 1,
     "tokenId": 5, "eventId": "…", "issuerPk": "…", "holderPk": "…",
     "currentPackage": { …el paquete privado actual completo… },
     "changes": [{ "fieldId": "…", "number": "40111222" }],
     "reason": "New DNI",
     "holderEncryptionKey": "…",
     "createdAt": "…"
   }
   ```
4. Lo cifra para `updateRequestKey` (el mismo esquema sealed box de la entrega de credenciales).
5. Calcula `payloadCommit = SHA-256(JSON del sobre)`. El JSON tiene un orden fijo de campos
   (`format, version, epk, iv, ciphertext`), para que el hash sobreviva al paso por el servidor.
6. **Primero** sube el sobre a `POST /api/credential-update` con `{ payloadCommit, envelope }`
   (Pinata privado, keyvalue `velumUpdateRequest`).
7. **Después** llama a `requestCredentialUpdate(tokenId, payloadCommit)` (una firma). El orden evita
   que el organizador vea en la cadena un pedido que no puede leer.
8. La credencial muestra "Update requested" mientras esté pendiente, y "dismissed" si el organizador
   lo rechazó. El estado lo lee de `GET /api/credential-update-requests/:tokenId`.

### 3.3 El organizador lo revisa
- En la lista de holders del evento, las filas con un pedido pendiente muestran **Review Update**.
  El pendiente sale de `GET /api/credential-update-requests?issuerPk=…&status=pending`, filtrado por
  evento. Solo lo ve el organizador del evento.
- **Paso 1, revisar:**
  - descarga los sobres de `GET /api/credential-update/:payloadCommit` y se queda solo con el que
    **cumple `SHA-256(sobre) == payloadCommit`** y se abre con su clave;
  - comprueba que el pedido sea de ese token y de su dueño;
  - verifica que `currentPackage` coincida con la credencial en la cadena
    (`credentialPathOnChain`, la misma comprobación que usa el holder).
  - Muestra número viejo → nuevo y el motivo.
  - Opciones: **Dismiss** (`dismissCredentialUpdate`, una firma) o **Re-issue**. Si el paquete no
    coincide con la cadena, no deja reemitir.
- **Paso 2, revocar:** `burn(tokenId)`, que también cierra el pedido.
- **Paso 3, emitir:** `mintTo` al **mismo `holderPk`** con:
  - el `tokenMetadataURI` del token viejo (mismas imágenes, sin volver a subir nada);
  - los mismos valores, pero con el número nuevo, `rand` nuevos y un salt (código) nuevo.
  - Los datos privados se entregan cifrados a la `holderEncryptionKey` que vino en el pedido. Si el
    envío falla, se muestra el link privado de siempre.
- **Retomar si se corta:** entre los pasos 2 y 3 el holder se queda sin credencial. Por eso, antes
  del `burn` se guarda un registro local (`velum:reissue:<eventId>:<tokenId>`, que entra en el
  backup cifrado) con todo lo necesario para el paso 3. Si existe, la fila del token quemado muestra
  **Finish Re-issue** y abre directo el paso 3. El registro se borra cuando el `mintTo` confirma.

---

## 4. Preguntas de vencimiento en palabras simples

Las credenciales con validez tienen el campo privado automático **Valid until** (fecha del último
día válido). Antes el verificador tenía que armar un rango de fechas a mano. Ahora, para ese campo,
las primeras opciones son:

| Pregunta | Rango que se publica (asOf = hoy) |
|---|---|
| Still valid (not expired) | `asOf` … `asOf + 30 años` |
| Has expired | `asOf − 30 años` … `asOf − 1 día` |
| Expires within 3 / 6 meses, 1 / 2 años | `asOf` … `asOf + N meses` |
| Valid for at least 3 / 6 meses, 1 / 2 años | `asOf + N meses` … `asOf + 30 años` |

- **Los rangos son comunes.** Por dentro sigue siendo un pedido de fecha
  (`onOrAfter` / `onOrBefore` / `between`), y el conjunto es la lista de días del rango, como
  cualquier otro.
- **Cómo se describe la pregunta.** La regla publicada lleva además
  `preset: { kind, asOf, months? }`, que solo sirve para describirla en palabras ("Still valid,
  but expires within 6 months (checked on 07/10/2026)").
- **Cuándo se acepta el preset.** Al leer la regla, la app reconstruye el rango desde el preset y
  **solo lo acepta si coincide exactamente** con `op/from/to`. Así una regla publicada por otro no
  puede ponerle una descripción engañosa a un rango distinto.
- **Validación del servidor.** No cambió: las claves extra pasan dentro del límite de 4 KB.
- **Fecha de referencia.** Se cuenta desde el día en que se pregunta (`asOf`), y la descripción
  siempre muestra esa fecha.
- **Las preguntas de fecha de siempre** ("on or after", "between", etc.) siguen disponibles debajo.

Otro cambio menor: los botones "View Blockchain Info" ahora dicen **View Info**.

---

## 5. Manejo de la información y privacidad

### 5.1 Qué queda en cada lugar

| Dato | Cadena | Indexer / API | Servidor `server/` (Pinata privado) | Navegador |
|---|---|---|---|---|
| Plantilla del campo (label, país, tipo de documento) | — | — | IPFS público (metadata del evento) | — |
| Número de documento | **Nunca** | — | Solo dentro de sobres cifrados | Holder y emisor (paquete local, backup cifrado) |
| Código de identidad (salt) | **Nunca** | — | Solo dentro de sobres cifrados | Holder y emisor; el holder lo comparte en su link (`#`, no llega al server) |
| `computeIdentityValue` | Solo como hoja con hash dentro del árbol de la credencial | — | Dentro del sobre de entrega | Holder |
| Pedido de identidad | `disclosureRequests`: verificador, evento, `fieldId`, raíz de un solo valor, destinatario | Sí | `{ op: "identity" }` | Verificador (número + código, no se guardan) |
| Respuesta a la prueba | Transacción `proveCredentialAttribute` (request id, raíz del árbol de credenciales) | — | — | Comprobante del holder |
| Clave del organizador para pedidos | — | — | IPFS público (`updateRequestKey`) | Se deriva de `local_sk` |
| Contenido del pedido de actualización | **Nunca** | — | Sobre cifrado para el organizador | Holder al armarlo; organizador al abrirlo |
| Que hubo un pedido, y cuándo | `credentialUpdateRequests[tokenId] = payloadCommit` | `credential_update_requests` (pending / dismissed / burned) | — | — |
| Registro de reemisión en curso | — | — | Solo dentro del backup cifrado | Organizador |
| Preset de vencimiento (`asOf`, meses) | — | — | En la regla de la pregunta (público) | — |

### 5.2 Qué puede saber cada uno

- **Cualquiera que mire la cadena o el indexer:**
  - que un verificador le pidió a un seudónimo un control sobre un campo de identidad;
  - que el seudónimo respondió;
  - que un holder pidió una actualización, y cuándo.
  - **No puede saber** el número, el país del holder (más allá de la plantilla pública), ni qué
    cambió.
- **El verificador:** el número que ya vio en el documento y el código que le dio el holder. La
  prueba le confirma que la credencial lleva **ese** documento.
- **El organizador:** todo lo que emitió (como antes) y el contenido de los pedidos de
  actualización.
- **El admin:** puede rechazar un pedido (`dismissCredentialUpdate`), pero no tiene la clave para
  leerlo. Igual, la app solo le ofrece la revisión al organizador del evento.
- **El operador del servidor (Pinata):** solo sobres cifrados, sus tamaños, horarios y los ids de
  búsqueda (`payloadCommit`, que ya es público en la cadena).

### 5.3 Límites que conviene tener presentes

- **Depende de dos controles humanos.** El emisor tiene que haber comprobado el documento al emitir,
  y el verificador tiene que comprobar el del postulante. La app lo dice en la interfaz.
- **Si se filtran el código y el número juntos**, quien los tenga puede relacionar esa credencial
  (ese seudónimo) con esa persona. Lo que no puede es responder por ella, porque sigue haciendo
  falta su `local_sk`. Por eso el link se marca como personal.
- **Son dos firmas, no una.** Identidad + pregunta son dos pedidos y dos pruebas (lo confirmaste).
  En la interfaz se siente como una sola acción.
- **El verificador tiene que exigir las dos pruebas.** Criptográficamente el préstamo queda
  bloqueado, pero solo si el verificador no acepta la respuesta sin la prueba de identidad. Para eso
  están el link combinado y el aviso "Identity proof missing" de `/app/verify`. El aviso depende de
  lo que el verificador publicó: si nunca pidió identidad, no hay nada que avisar.
- **Qué no cubre:** que el emisor cargue mal el documento, que el verificador no mire el documento
  físico, las credenciales emitidas sin campo de identidad y la suplantación física (alguien que
  se presenta con el DNI de otro).
- **Pedidos basura.** Cualquiera puede subir sobres bajo un `payloadCommit`. El organizador descarta
  los que no tienen ese hash o no abren con su clave, y el servidor devuelve como mucho 10
  candidatos.
- **Rangos largos.** "Still valid" o "Has expired" abarcan unos 11.000 días: al holder le toma unos
  segundos armar el conjunto, igual que las preguntas de fecha de antes.

---

## 6. Cambios en `server/` (hay que redesplegar)

- `POST /api/credential-update` `{ payloadCommit, envelope }` y
  `GET /api/credential-update/:payloadCommit`: el mismo patrón que `/api/credential-delivery`.
- `validRule` de `/api/disclosure-sets` acepta `{ "op": "identity" }`.

Sin ese redespliegue fallan el control de identidad (no se puede publicar la regla) y los pedidos
de actualización.

---

## 7. Para que revises

1. **`payloadCommit` = SHA-256 del sobre cifrado.** Tu documentación dice "e.g. its hash". Si
   preferís otro esquema (por ejemplo, un hash del texto plano con sal), es fácil de cambiar.
2. **Salt de 32 bytes aleatorios por documento y por credencial**, y entradas rellenadas con ceros a
   32 bytes, como dice `integration.md`.
3. **Reemisión:** `burn` del emisor y después `mintTo` al mismo seudónimo, con un salt nuevo.
   Contamos con que `mintTo` acepta reemitir después de una revocación, como subiste el 01/10.
4. **Indexer:** usamos `ownerPk`, `issuerPk`, `eventId`, `status` y `payloadCommit` de
   `/api/credential-update-requests`. Si algún nombre cambia, avisanos.
5. **Prueba en vivo** pendiente en preprod, con tres wallets (organizador, holder y verificador),
   incluyendo los casos negativos: DNI equivocado y pedido rechazado.

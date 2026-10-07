# Velum — funcionalidades y casos de uso

Estado al 2026-09-24. Proyecto Catalyst Fund 11 #1100234. Describe el producto tal como está en la
rama `feature/production`: qué puede hacer cada tipo de usuario y para qué sirve cada categoría de
evento en la vida real.

---

## 1. Qué es

Un portal para emitir, recibir y **probar** POAPs (constancias digitales de "estuve", "soy
miembro de" o "me certificaron") sobre **Midnight**, la cadena de IOG con contratos de
conocimiento cero. A diferencia de un POAP en Ethereum, acá la cadena no expone a quién pertenece
cada constancia ni permite cruzar a una persona entre organizadores, y quien tiene la constancia
puede demostrar cosas sobre ella **sin mostrarla**.

Lo que lo diferencia:

- **Un seudónimo distinto por organizador.** Dos organizadores no pueden saber que tienen al mismo
  asistente. Nada en la cadena une tus POAPs entre sí.
- **Pruebas anónimas.** "Tengo una entrada válida de este evento" o "mi sector está en esta
  lista", sin decir cuál entrada ni qué wallet.
- **Datos privados por credencial.** La cadena guarda solo una huella (raíz Merkle). Los valores
  viajan cifrados al holder y nuestros servidores no pueden leerlos.
- **Rangos.** "Tengo al menos 18 años" o "mi credencial vence después de hoy", sin revelar la fecha.
- **Verificación sin wallet.** Quien recibe una prueba abre un link y la ve confirmada en la cadena.
- **Validez y revocación.** Cada POAP puede vencer, y el emisor puede revocarlo: desde ese momento
  sus pruebas dejan de pasar.

---

## 2. Categorías de evento

Al crear un evento se elige una categoría. Define quién obtiene el POAP y cómo.

| Categoría | Quién lo obtiene | Cómo | Verbo en la app | Datos privados |
|---|---|---|---|---|
| **Event** | Cualquiera | Lo reclama él mismo (claim) | Attend / Attended | No |
| **Subscription** | Cualquiera | Lo reclama él mismo | Subscribe / Follow | No |
| **Credential** | Una persona concreta | Lo emite el organizador (mintTo) | Received | Sí, por persona |

Cada categoría tiene su propia taxonomía (tipo de organizador, formato, propósito, industria, tipo
de credencial…), usada para describir y filtrar.

---

## 3. Funcionalidades por rol

### 3.1 Todos

- **Landing** con los casos de uso y **hub de la app** (`/app`) para elegir rol (Organizer o
  Subscriber). Cada rol recuerda la última página visitada.
- **Conectar la wallet** (Lace o 1am, con selector si hay más de una). La primera vez en un
  navegador se elige empezar de cero o restaurar.
- **Identidad sin contraseñas.** Cada wallet tiene una clave aleatoria en el navegador, que es
  también su **recovery code**.
- **Backup cifrado** (Backup & Restore). Se cifra en el navegador y se sube solo a Pinata privado
  cada vez que algo cambia; también hay descarga en archivo. Incluye la identidad, los datos
  privados de las credenciales y el historial de pruebas.
- **Progreso de cada transacción** en un solo popup (preparar → probar → firmar → confirmar).
- **Ver en la cadena**: "View Info" en eventos y POAPs (ids, bloques, transacciones).

### 3.2 Organizador

- **Crear eventos** con un asistente paso a paso: categoría, nombre, descripción e imagen, cupo,
  fecha límite, **validez**, canales de contacto, taxonomía, perfil del organizador, **campos
  privados con tipo** (solo Credential) e imagen del POAP (solo Event y Subscription). Crear
  eventos es libre: no hace falta estar registrado.
- **Validez.** Cuánto dura cada POAP (horas, días, meses o años):
  - Subscription: cuenta desde la última prueba de tenencia del holder, que se renueva probando de
    nuevo.
  - Event: desde el reclamo.
  - Credential: desde la emisión. Además la credencial recibe un campo privado **"Valid until"**
    que el holder puede probar sin mostrarlo.
- **Campos privados con tipo** (Credential): Texto, Número entero (con mínimo y máximo), Fecha o
  Lista de opciones. Solo se publican los nombres y el tipo; los valores se cargan al emitir.
- **Invitar con link + QR.** "Invite Link" genera un link que, al abrirlo, crea la clave del
  destinatario y le da un link de vuelta para que el organizador emita. Sirve en persona
  (escaneando el QR) o a distancia (por chat o mail).
- **Emitir credenciales** (Mint POAP): destinatario (pegado o traído por el link), valores
  privados de esa persona validados según el tipo, imagen del documento (la entrada, el diploma) e
  ícono. Los datos privados se envían cifrados; si el código del destinatario es viejo, la app da
  un link privado para mandarlos a mano.
- **Ver a sus holders** con estado (Active / Burned) y un gráfico de emitidos, quemados y
  disponibles.
- **Revocar** un POAP desde esa lista. Es permanente: el holder lo sigue viendo como Burned, pero
  ya no puede probar nada con él.
- **Habilitar pruebas de tenencia** ("Ask for Proof of Ownership"): una firma por evento, así sus
  holders prueban con una sola firma y sin exponer su identidad.
- **Hacer preguntas sobre datos privados** ("Ask for a Disclosure", solo Credential), según el tipo
  del campo:
  - Texto o Lista: "es uno de …".
  - Número: "≥", "≤", "entre" o "es uno de".
  - Fecha: "antes de", "después de", "entre" o "al menos N años atrás".
  - Vencimiento (campo automático "Valid until"): en palabras simples, "sigue vigente", "está
    vencida", "vence dentro de 3/6 meses o 1/2 años" o "sigue vigente al menos 3/6 meses o 1/2
    años". Se cuenta desde el día en que se pregunta.
  - **Control de identidad** (credenciales con un documento de identidad): el verificador escribe el
    número del documento que tiene delante y el código de identidad del holder (viene en su link).
    Se publica como un segundo pedido junto con la pregunta; el holder responde los dos juntos y
    manda un solo link que verifica las dos pruebas. Viene activado: apagarlo pide confirmación.
- **Documentos de identidad en las credenciales**: un tipo de campo privado con país y tipo de
  documento fijos (por ejemplo "DNI, Argentina"). Al emitir se escribe el número; en la cadena solo
  queda una huella con sal. Evita que alguien responda con la credencial de un amigo.
- **Pedidos de actualización**: en la lista de holders, "Review Update" muestra el número viejo y el
  nuevo; se rechaza o se reemite en tres pasos guiados (revisar, revocar, emitir). Si se corta entre
  los dos últimos, "Finish Re-issue" lo retoma.
- **Perfil de organizador verificado**: el admin puede registrar organizadores (insignia opcional;
  no hace falta para crear eventos).

### 3.3 Holder (asistente, suscriptor o dueño de una credencial)

- **Explorar eventos** de otros organizadores y **reclamar** los de categoría Event o Subscription.
  Se puede marcar como soulbound (intransferible).
- **Get My Key**: genera la clave para un organizador (seudónimo + clave de cifrado). Viene con un
  link de emisión y un QR para mandárselo. Con el link de invitación del organizador, se genera
  sola.
- **My Subscriptions**: todos sus POAPs, leídos de la cadena por su seudónimo (también los que le
  emitieron sin que tuviera que hacer nada).
- **Datos privados** de cada credencial: llegan cifrados, se verifican contra la cadena y se muestran
  tapados hasta tocar "Show".
- **Badge de validez**: "Valid until …", "Active until …", "Expired" o "Not proven yet".
- **Prove Ownership**: prueba pública de "este POAP es mío". Muestra el número de token, nunca la
  wallet.
- **Prove Ownership Anonymously**: "tengo un POAP válido de este evento", sin decir cuál.
- **Prove a Private Detail**: responde las preguntas del organizador sin revelar el valor, qué
  credencial es ni la wallet. Si el valor no califica, el botón se desactiva sin tocar la cadena.
  Un control de identidad y la pregunta que vino con él se responden juntos ("Respond", una firma
  cada uno), y se obtiene un solo link que verifica las dos pruebas.
- **Código de identidad**: si la credencial tiene un documento, el holder ve el documento tapado y
  su código. El link para quien pregunta lleva el código, nunca el número.
- **Request Update**: si cambia su documento, le pide al organizador que reemita la credencial. El
  pedido va cifrado; en la cadena solo queda que lo pidió.
- **Aviso de anonimato**: antes de una prueba anónima, "Anonymous among N holders". Con menos de 5
  aparece un aviso, porque con pocos holders la prueba casi identifica a la persona.
- **Comprobante** de cada prueba, con link de verificación, y **Proof history** en la card
  (badge "Proven · fecha"). Solo lo ve el holder.
- **Burn**: quemar su propio POAP.
- **Colección para compartir** (`/app/share/…`): una página pública con los POAPs que elija mostrar.

### 3.4 Verificador (sin wallet)

- **`/app/verify`**: con el link o el hash de una prueba muestra si es válida, qué probó (en
  palabras), de qué evento, quién lo preguntó, cuándo, si el token sigue vigente o fue revocado, y
  **hasta cuándo es válido**:
  - Subscription: desde esa prueba.
  - Event o Credential: desde la emisión, cuando la prueba nombra el token.
- **Varias pruebas en un link** (`?tx=a,b`): verifica todas y dice si las respondió el mismo holder.
  Si una respuesta venía con un control de identidad del mismo verificador y esa prueba no está,
  avisa "Identity proof missing".
- No hace falta cuenta, wallet ni confiar en quien muestra la prueba: la página lee la transacción
  directamente de la cadena.

### 3.5 Admin

- Registrar y desactivar organizadores verificados.
- El contrato también le permite revocar cualquier POAP. En la app, el botón Revoke aparece en las
  listas de holders que ve.
- Página de despliegue del contrato (`/app/admin/deploy`, restringida).

---

## 4. Casos de uso reales

### 4.1 Event — "estuve ahí"

Cualquiera lo reclama. El valor está en la **reputación portable** y en poder probarla sin exponer
el historial completo de eventos de la persona.

| Caso | Cómo se usa |
|---|---|
| **Meetups y conferencias** (Catalyst town halls, charlas) | "Fui a 5 town halls" para entrar a un canal de alumni o sumar puntos en una votación: prueba anónima de tenencia en cada evento, sin que se arme un perfil público de la persona. |
| **Talleres y hackatones** | "Participé" como llave para la edición siguiente o un descuento. La tienda pide Prove Ownership Anonymously. |
| **Recitales y ferias abiertas** | Recuerdo coleccionable y prueba de asistencia para sorteos entre asistentes (Prove Ownership, que muestra el número). |
| **Eventos de un día con beneficio posterior** | Validez de 1 a 7 días: "Valid until" en el POAP para canjear un beneficio solo esa semana. |

**No sirve** cuando el POAP da algo escaso (cupos, premios): cualquiera con el link lo reclama, y
con varias wallets puede reclamar varias veces. Para eso está Credential.

### 4.2 Subscription — "soy miembro"

Membresía continua. La validez desde la última prueba convierte al POAP en una **membresía
activa**: tenerlo no alcanza, hay que probarlo cada tanto.

| Caso | Cómo se usa |
|---|---|
| **Club de fans o comunidad** | "Soy miembro" ante un sponsor o una marca aliada con prueba anónima: el sponsor no sabe quién es ni ve sus otras membresías. |
| **Newsletter o contenido premium** | Validez de 30 días: el miembro prueba una vez por mes y su badge dice "Active until …". Si el organizador lo revoca, ya no puede renovar. |
| **Gimnasio, cowork, biblioteca** | "Membresía activa" en la puerta, probando tenencia en el momento. |
| **Métricas para sponsors** | Cuántos miembros activos hay, sin datos personales de ninguno. |
| **Follow gratuito de un creador o marca** | Seguidores que después pueden probar que lo son para acceder a preventas o canales, sin exponer su wallet. |

**Límite actual:** los niveles (básico / premium) serían eventos separados, y la renovación la hace
el holder probando: es una señal de confianza, no un control de pago.

### 4.3 Credential — "me certificaron esto"

Emitida por el organizador a una persona concreta, con datos privados propios. Es donde el
producto aporta más. En todos los casos la confianza está en el emisor: la prueba dice "X certificó
esto", que es exactamente lo que se necesita.

| Caso | Campos privados típicos | Qué se prueba sin revelar |
|---|---|---|
| **Entrada con asiento** | Sector (lista), Fila, Asiento, Titular | "Tengo entrada" en la puerta; "Sector ∈ {Campo, Platea}" para acceder a una zona. Revocación por reventa o reembolso. |
| **Título o certificado académico** | Carrera (lista), Promedio (número), Egreso (fecha) | "Me recibí en X" y "Promedio ≥ 7" ante un empleador, que verifica con el link sin ver el resto del certificado. |
| **Matrícula profesional** (médica, abogacía, contable) | Especialidad (lista), Valid until (fecha, automático) | "Matrícula vigente" = "Valid until ≥ hoy", sin dar el número. Si se revoca, las pruebas dejan de pasar. |
| **Licencia de conducir** (validez 5 años) | Categoría (lista), Nacimiento (fecha), Valid until | "Categoría ∈ {B1, B2}", "tengo al menos 18 años", "licencia vigente". |
| **Credencial de empleado / acceso** | Área (lista), Nivel (número) | "Área ∈ {Ingeniería, Operaciones}" para entrar a un piso sin registrar quién entró. |
| **Edad o residencia** emitida por alguien de confianza (club, municipio) | Nacimiento (fecha), Ciudad (lista) | "Al menos 18 años" o "residente de X" para un servicio, sin mostrar documento. |
| **Certificado de curso con horas** | Horas (número), Nota (número) | "Horas ≥ 20" para acreditar formación continua. |
| **Documentación privada** (contratos, constancias) | Tipo (lista), Fecha (fecha) | Que existe una constancia emitida por la entidad y que cumple una condición, sin exponer el documento. |

**Flujo típico (entrada):** la productora crea el evento Credential con sus campos → comparte el
Invite Link → el fan lo abre y devuelve su link → la productora emite con los datos del fan → el
fan recibe su entrada cifrada → en la puerta, seguridad le pide una prueba y la verifica con el link.

---

## 5. Qué ve cada quién

| Dato | Quién lo ve |
|---|---|
| Nombre, imagen, descripción y categoría del evento | Cualquiera (IPFS público) |
| Nombres y tipos de los campos privados | Cualquiera |
| Valores privados de una credencial | Solo el holder (y el emisor, que los cargó) |
| Qué wallet tiene qué POAP | Nadie: la cadena solo guarda un seudónimo por organizador |
| Que un POAP existe, su evento y si fue quemado | Cualquiera |
| Las preguntas ("Edad ≥ 18") | Cualquiera |
| La respuesta concreta del holder | Nadie: solo que califica |
| El historial de pruebas | Solo el holder |
| La identidad privada (`local_sk`) | Solo el navegador del usuario (y su backup cifrado) |
| Número de documento y código de identidad | El holder, el emisor y a quien el holder se los muestre |
| Que un holder pidió una actualización (no qué cambió) | Cualquiera |

**Advertencia honesta:** las pruebas se generan en un *proof server*. En producción será uno
alojado por el proyecto, que ve los datos de cada prueba mientras la genera (no los guarda). La
cadena y los demás usuarios no ven nada.

---

## 6. Límites conocidos

- **Una prueba se puede repetir.** Demuestra que tenés el POAP, no lo "consume": no hay prueba de
  un solo uso (necesita un cambio de contrato).
- **El anonimato depende del tamaño del evento.** La app lo avisa con menos de 5 holders.
- **La validez no la conoce el contrato.** La calcula la app. Una prueba anónima de una credencial
  no dice si venció; para eso está la pregunta "sigue vigente" sobre el campo "Valid until".
- **Rangos grandes tardan.** Un rango de fechas de 100 años son unos 36.500 valores: unos segundos
  para preguntar, probar y verificar.
- **Cada prueba es una transacción.** Cuesta DUST y tarda lo que tarde la red.
- **Sin el recovery code no hay recuperación.** Si se pierde el navegador y el código, los POAPs
  siguen existiendo pero ya no se puede probar que son propios.
- **Onboarding de wallet.** Instalar Lace o 1am, tener NIGHT y generar DUST es la barrera más alta
  para el público general.

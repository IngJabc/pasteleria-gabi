# SPEC.md — E-commerce de Pastelería

**Estado:** Especificación funcional inicial  
**Versión:** 1.0  
**Moneda comercial:** USD  
**Moneda local:** VES  
**Ubicación del negocio:** Tamaca, zona norte de Barquisimeto, Lara, Venezuela.

---

## 1. Objetivo del proyecto

Desarrollar una tienda online para comercializar raciones individuales de tortas, con un panel administrativo privado que permita gestionar productos, inventario, pedidos, pagos, ventas presenciales y operaciones del negocio.

La solución debe ser sencilla de administrar por dos personas, funcionar correctamente desde dispositivos móviles y mantener un control confiable del inventario y del dinero.

El proyecto será independiente de Nómadas Tour y de Nómadas Marketplace, incluyendo repositorio, base de datos, credenciales y recursos de infraestructura.

## 2. Usuarios y permisos

Existirán dos administradores, cada uno con su propia cuenta.

Ambos podrán:

- Consultar y gestionar pedidos.
- Crear y editar productos.
- Administrar inventario.
- Registrar ventas presenciales.
- Verificar pagos y comprobantes.
- Registrar pagos externos.
- Gestionar cancelaciones y devoluciones.
- Consultar estadísticas e historial de operaciones.
- Recibir notificaciones de actividad.

No habrá registro público de administradores ni cuentas de clientes obligatorias.

## 3. Catálogo de productos

La tienda comenzará con tres variedades de tortas, pero deberá permitir incorporar nuevos productos sin modificaciones técnicas.

Cada producto tendrá:

- Nombre.
- Descripción.
- Precio en USD.
- Fotografías.
- Estado activo/inactivo.
- Inventario disponible.
- Fecha de creación y actualización.

Los precios se publicarán en USD.

El cliente podrá consultar productos y agregar distintas variedades al carrito.

## 4. Moneda y tasa de cambio

La moneda comercial será USD.

Para calcular pagos en bolívares se utilizará la tasa BCV.

Cada pedido conservará una fotografía histórica de:

- Precio de los productos en USD.
- Subtotal.
- Delivery.
- Total en USD.
- Tasa BCV aplicada.
- Fecha y hora de la tasa.
- Total calculado en VES.
- Regla de redondeo aplicada.

La tasa deberá consultarse automáticamente y conservarse históricamente.

Si el servicio de consulta no está disponible, se podrá utilizar la última tasa válida almacenada, informando su antigüedad. Nunca se utilizará una tasa desconocida.

## 5. Métodos de pago

Métodos previstos:

1. Pago Móvil en VES.
2. Efectivo en USD.
3. Binance Pay en USDT.
4. Transferencias entre usuarios de Binance en USDT.

Se permitirán varios métodos en una misma operación de pago.

### Pagos digitales

El cliente deberá adjuntar comprobante.

El comprobante no representa una confirmación automática del pago. Los administradores deberán verificar que el dinero efectivamente llegó.

Se registrarán:

- Método.
- Moneda.
- Importe.
- Referencia o identificador.
- Comprobante.
- Estado de verificación.
- Administrador que verificó.
- Fecha y hora.

La migración 006 (`006_payments_and_verification.sql`, solo local) implementa
este backend: los comprobantes se almacenan en el bucket privado
`payment-receipts` con ruta `{order_id}/{uuid}.{ext}`; el servidor valida el tipo
MIME (jpeg/png/webp/PDF), el tamaño (≤ 5 MB), la propiedad derivada del token, el
estado del pedido y la elegibilidad de la presentación, y sube el archivo con el
service role. No se confía en el MIME/tamaño/ruta informados por el cliente; si
falla el RPC, se elimina el objeto. El vínculo `receipt_submissions.payment_id`
asocia el historial de revisión/SLA (OQ-16) con **un** componente de pago; como
máximo existe una presentación pendiente por pedido y por pago. Los pagos en
efectivo no crean presentación, no requieren comprobante y nunca incrementan
`orders.receipt_attempts`. El límite existente de dos comprobantes por pedido
sigue vigente, por lo que solo pueden existir dos presentaciones digitales de
evidencia por pedido.

### Efectivo

Se permitirá efectivo en USD para pedidos online y presenciales, independientemente del método de entrega.

Para pedidos online, se cobrará al entregar o retirar el pedido.

El checkout tendrá un campo opcional para indicar con cuánto dinero pagará el cliente, permitiendo calcular el vuelto.

### Pagos combinados

Cada componente del pago deberá registrarse individualmente. El pedido se considerará completamente pagado cuando se hayan cubierto y verificado todos los importes correspondientes.

No habrá un sistema de cuotas ni de pagos parciales pendientes para completar en diferentes operaciones posteriores. El efectivo contra entrega constituye una modalidad de cobro diferida expresamente permitida.

**Implementación (migración 006; backend local, sin interfaz):** los pares
método/moneda almacenados son **exactamente** `pago_movil`→VES, `cash_usd`→USD,
`binance_pay`→USDT y `binance_transfer`→USDT (Binance Pay y transferencias entre
usuarios, ambos en USDT; los datos identificativos de Binance siguen pendientes
de descubrimiento, §19). No existe otro método ni otra moneda. Un pago es un
componente de un pedido: un pedido puede tener varios componentes y varias
monedas. `get_order_payment_summary` informa importes aprobados/pendientes/en
revisión/rechazados/devueltos y conteos de pagos **por moneda**; los importes
brutos nunca se suman entre monedas. No hay conversión autoritativa, decisión de
"pagado por completo" entre monedas ni cumplimiento automático: los importes son
valores declarados de cada componente que los administradores verifican. Esta
ausencia es una brecha documentada, no una regla de negocio. Siguen abiertos OQ-4
(ruta de escritura de la tasa BCV), OQ-5 (regla de redondeo) y el descubrimiento
del comprobante de Binance. La documentación técnica denominaba este alcance
"Fase 4" y las tareas lo denominan "Fase 5"; ambos nombres designan el mismo
módulo de pagos.

## 6. Delivery y retiro

El negocio está ubicado en Tamaca, zona norte de Barquisimeto.

Tarifas iniciales:

- Zona norte de Barquisimeto: gratis.
- Resto de Barquisimeto: $5.
- Fuera de Barquisimeto: cotización manual.

No se utilizará Google Maps ni será obligatorio integrar servicios de geolocalización.

El cliente deberá escribir su dirección y seleccionar la clasificación correspondiente.

El checkout mostrará un aviso indicando que la tarifa será verificada y que el negocio comunicará el importe definitivo antes de confirmar el pago.

Los administradores podrán corregir la clasificación y ajustar la tarifa.

Los pedidos que requieran cotización quedarán pendientes de confirmación del importe definitivo. Mientras se espera la cotización, el inventario permanece reservado sin expiración automática. Solo cuando el cliente acepte explícitamente la tarifa de delivery cotizada se iniciará un nuevo plazo inicial fijo de 20 minutos para la reserva, según la sección 8 (implementado en la Fase 4; el plazo histórico `initial_expires_at` permanece inmutable y la nueva ventana se registra por separado). Ese plazo es de reserva de inventario: no es el plazo de revisión administrativa de 24 horas de la sección 14, ni sustituye o modifica la ventana de corrección de 20 minutos posterior al primer rechazo del comprobante. Los reintentos administrativos no lo extenderán.

### Retiro presencial

El cliente podrá retirar su pedido en la dirección del negocio.

La dirección exacta se configurará desde el panel y se comunicará al cliente cuando el pedido esté listo para retirar.

## 7. Checkout y pedidos online

No será obligatorio crear una cuenta.

El checkout solicitará:

- Nombre y apellido.
- Teléfono WhatsApp.
- Método de entrega.
- Dirección, cuando corresponda.
- Referencias de ubicación.
- Instrucciones adicionales opcionales.
- Método o métodos de pago.
- Importe con el que pagará, si selecciona efectivo.

El servidor deberá recalcular todos los importes, comprobar el inventario y validar el delivery.

Cada pedido tendrá un identificador y un enlace privado de seguimiento basado en un token aleatorio.

El cliente podrá consultar el estado de su pedido sin registrarse.

## 8. Inventario

El inventario representará las raciones físicas disponibles, ya elaboradas.

No se manejará producción bajo demanda.

Se utilizará un sistema de lotes con:

- Producto.
- Cantidad inicial.
- Cantidad restante.
- Fecha de elaboración.
- Administrador responsable.

La fecha de elaboración será exclusivamente administrativa y nunca aparecerá en la tienda.

Se utilizará FIFO: las ventas descontarán primero las unidades de los lotes más antiguos.

### Movimientos

Se permitirán:

- Entradas por nuevas raciones elaboradas.
- Salidas por ventas.
- Ajustes negativos por daños, consumo interno, pérdidas u otras causas.
- Ajustes positivos por correcciones.

Todos los movimientos conservarán fecha, administrador, producto, cantidad y motivo.

### Reservas

Los pedidos online reservarán inventario inmediatamente al crearse.

La reserva inicial expirará a los 20 minutos si el cliente no envía el comprobante de pago. Para pedidos con cotización manual de delivery, la reserva permanece retenida sin expiración automática mientras se espera la cotización, y el plazo inicial de 20 minutos se inicia recién cuando el cliente acepta explícitamente la tarifa cotizada (OQ-17, resuelto e implementado en la Fase 4; `initial_expires_at` se conserva inmutable y la nueva ventana se escribe en `quote_acceptance_expires_at` y se copia en `expires_at`).

Si los administradores rechazan un comprobante enviado, el cliente dispondrá de 20 minutos adicionales para corregirlo y volver a enviarlo. Este rechazo no libera inventario: inicia la única ventana de corrección. Se permiten como máximo dos comprobantes en total (el original y una corrección); el primer rechazo mantiene la reserva retenida durante la revisión, y el segundo rechazo cancela automáticamente el pedido y libera sus reservas.

El plazo máximo de 24 horas de la sección 14 corresponde a la revisión administrativa del comprobante; no es la duración de la reserva de inventario. Cada comprobante enviado inicia su propio plazo (el original y su corrección tienen relojes independientes). Al superarse, se notifica a todos los administradores activos cada 15 minutos hasta que ese comprobante sea aprobado o rechazado (OQ-16, resuelto e implementado localmente en la Fase 6 mediante la migración 005 y un worker dedicado; no aplicado remotamente ni desplegado). El vencimiento de ese plazo no cancela el pedido ni libera inventario, y no sustituye ni modifica los plazos de reserva de 20 minutos descritos en esta sección. Los reintentos administrativos no extienden ninguno de estos plazos.

El inventario reservado no podrá venderse a otro cliente.

Las reservas se liberan al cancelar (incluido el cancelado automático por un segundo rechazo) o expirar un pedido. Cuando la ventana de corrección venza sin un comprobante válido, la reserva expirará y las unidades volverán a estar disponibles. Los pedidos con cotización manual permanecen reservados mientras se confirma la cotización; la aceptación explícita de la tarifa por el cliente inicia un nuevo plazo inicial de 20 minutos que no puede extenderse mediante reintentos administrativos.

Las operaciones de reserva, venta y liberación deberán ser atómicas e idempotentes.

## 9. Ventas presenciales y pagos externos

El panel funcionará también como un pequeño POS.

Los administradores podrán registrar ventas presenciales con:

- Productos y cantidades.
- Precios aplicados.
- Métodos de pago.
- Importes recibidos.
- Referencias cuando correspondan.
- Fecha y hora.
- Administrador responsable.

El inventario se descontará inmediatamente.

Se distinguirán los pedidos online de las ventas presenciales.

También se podrá registrar un pago recibido fuera de la web para un pedido online existente, sin crear una segunda venta ni duplicar el descuento de inventario.

**Implementación (migración 006; backend local, sin interfaz):** la venta
presencial se registra como una sola fila de `orders` con `channel = 'pos'`, con
precios recalculados por el servidor, asignación FIFO inmediata y consumo de
inventario mediante el RPC existente `consume_order_reservations`, un único
componente de pago en efectivo aprobado e idempotencia por clave. No hay doble
descuento de inventario. El registro de pagos externos contra pedidos online
existentes también forma parte de este backend. La identidad del cliente en POS
(OQ-11) sigue sin resolverse.

## 10. Estados de pedidos y pagos

El estado del pedido será independiente del estado del pago.

Los estados deberán representar, como mínimo:

**Pedido:**
- Pendiente de pago o verificación.
- Confirmado.
- Listo para retirar o entregar.
- Completado.
- Cancelado.
- Expirado.

**Pago:**
- Pendiente.
- En revisión.
- Aprobado.
- Rechazado.
- Devuelto parcialmente.
- Devuelto totalmente.

La aprobación del pago no significa automáticamente que el pedido haya sido entregado.

La verificación de pagos es independiente del cumplimiento del pedido. Los RPC
de aprobación/rechazo de la migración 006 no cambian por sí mismos
`orders.status`, no escriben movimientos de inventario, no consumen ni liberan
reservas y no modifican `receipt_attempts`. Los RPC existentes M3/M5 siguen siendo
la única implementación del límite de dos comprobantes, de la única ventana de
corrección de 20 minutos y de la cancelación automática por segundo rechazo; la
migración 006 los invoca en lugar de reimplementarlos. Como los productos ya están elaborados, no es obligatorio un estado de preparación posterior a la compra.

## 11. Cancelaciones

El cliente podrá solicitar la cancelación:

- Desde el enlace privado de seguimiento.
- Por WhatsApp, incluso si perdió el enlace.

Las solicitudes deberán llegar al panel administrativo.

Los administradores decidirán si las aprueban.

La cancelación no liberará inventario ni modificará pagos hasta que la operación sea autorizada y registrada correctamente.

Si existió un pago, la devolución se registrará por separado.

## 12. Devoluciones

No habrá reembolsos automáticos.

Los administradores podrán registrar devoluciones parciales o totales, conservando:

- Pago original.
- Importe devuelto.
- Moneda.
- Método de devolución.
- Motivo.
- Administrador responsable.
- Fecha y hora.

Una devolución no deberá borrar ni modificar el registro histórico del pago original.

**Implementación (migración 006; backend local, sin interfaz):** `payment_refunds`
es append-only, con idempotencia por clave y moneda copiada del pago original. El
importe devuelto no puede superar el del pago; el estado del pago pasa a
`refunded_partial` o `refunded_full`. OQ-7 (dominio de valores del método de
devolución) permanece abierto: el método se registra como texto no vacío, sin
inventar un dominio.

## 13. Notificaciones y comunicación

WhatsApp será el principal canal de comunicación.

No se integrará inicialmente WhatsApp Business API.

El panel permitirá abrir conversaciones mediante enlaces de WhatsApp con mensajes preparados.

Se utilizará Supabase Realtime para notificar a ambos administradores cuando:

- Se cree un pedido online.
- Se envíe un comprobante.
- Se produzcan actualizaciones relevantes de pedidos y pagos.
- Se supere el plazo de 24 horas de revisión de un comprobante (sección 14): se notificará a todos los administradores activos y se repetirá cada 15 minutos hasta que ese comprobante sea aprobado o rechazado, sin cancelar el pedido ni liberar inventario. Ejecuciones simultáneas del proceso de notificación no deben generar avisos duplicados para el mismo comprobante e intervalo.

Las notificaciones serán informativas. La fuente de verdad siempre será la base de datos.

## 14. Horarios

La tienda aceptará pedidos las 24 horas.

El panel permitirá configurar los horarios de atención y preparación.

Los horarios informarán al cliente, pero no impedirán realizar pedidos fuera del horario habitual.

Los administradores tendrán un máximo de 24 horas desde el envío de un comprobante para revisarlo. Este plazo es operativo y no define la duración de la reserva de inventario (sección 8). Al superarse se notificará a todos los administradores activos cada 15 minutos hasta que ese comprobante sea aprobado o rechazado; no se cancelará el pedido ni se liberará inventario por el vencimiento de este plazo administrativo.

## 15. Panel administrativo

Se contemplan los siguientes módulos:

1. Dashboard.
2. Pedidos.
3. Productos.
4. Inventario y lotes.
5. Ventas presenciales.
6. Pagos y comprobantes.
7. Cancelaciones y devoluciones.
8. Configuración de la tienda.
9. Historial de movimientos.
10. Usuarios administradores.

El dashboard mostrará información relevante como pedidos pendientes, comprobantes por revisar, inventario disponible, ventas y actividad reciente.

## 16. Seguridad

La implementación deberá cumplir estas reglas:

- RLS en todas las tablas expuestas.
- Autorización administrativa validada desde la base de datos.
- No confiar en roles provenientes de `user_metadata`.
- Service Role exclusivamente en servidor.
- Comprobantes almacenados en bucket privado.
- Fotografías de productos en almacenamiento público.
- Precios, delivery y totales recalculados en servidor.
- Inventario protegido mediante operaciones transaccionales.
- Transiciones de estados validadas en servidor.
- Enlaces de seguimiento con tokens aleatorios y almacenamiento de hashes.
- Protección frente a duplicación de pagos, reservas y ventas.
- Auditoría de operaciones administrativas.

## 17. Arquitectura tecnológica prevista

- Next.js App Router.
- TypeScript.
- Tailwind CSS.
- Supabase PostgreSQL.
- Supabase Auth.
- Supabase Storage.
- Supabase Realtime.
- Funciones PostgreSQL/RPC para operaciones críticas.
- Vercel para frontend.

No se añadirán servicios externos o infraestructura adicional sin una necesidad concreta.

## 18. Identidad visual

Pendiente de definición.

El negocio todavía no tiene nombre comercial, logo, slogan ni sistema de identidad visual definitivo.

Se utilizará Figma AI para explorar conceptos y diseñar las interfaces de alta fidelidad.

No se fijará una identidad definitiva hasta que el negocio apruebe una propuesta.

## 19. Pendientes de descubrimiento

- Nombre comercial e identidad visual.
- Catálogo definitivo, precios y fotografías.
- Datos reales de Pago Móvil.
- Identificador y datos de recepción de Binance.
- Confirmar modalidad técnica de Binance Pay y transferencias entre usuarios.
- Dirección de retiro.
- Número de WhatsApp.
- Horarios concretos.
- Definir cómo se consulta y actualiza la tasa BCV.
- Precisar los límites geográficos de la zona norte para la clasificación que hará el cliente.
- Definir el tratamiento operativo de pedidos con efectivo contra entrega y pagos combinados.
- Definir la política comercial para pedidos con cotización de delivery (el plazo de reserva tras la aceptación de la tarifa ya está definido en las secciones 6 y 8; falta la política comercial en sí).

Tras la migración 006 siguen abiertos: OQ-7 (métodos de devolución), OQ-11
(identidad del cliente en POS), OQ-12 (revisión del comprobante por el invitado),
OQ-4 y OQ-5 (tasa BCV y redondeo), el identificador y los datos de recepción de
Binance (incluida la modalidad técnica de ambas variantes) y la política
operativa de efectivo contra entrega y pagos combinados. Ninguno se resuelve en
esta migración.

Estos pendientes no impiden avanzar con el diseño visual ni con la arquitectura inicial, pero deberán resolverse antes de implementar los flujos afectados.

---

**Criterio general:** priorizar una solución sencilla, segura, mantenible y adecuada al volumen de un pequeño negocio. No introducir complejidad propia de plataformas grandes si no existe una necesidad real.
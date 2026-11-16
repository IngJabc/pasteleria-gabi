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

### Efectivo

Se permitirá efectivo en USD para pedidos online y presenciales, independientemente del método de entrega.

Para pedidos online, se cobrará al entregar o retirar el pedido.

El checkout tendrá un campo opcional para indicar con cuánto dinero pagará el cliente, permitiendo calcular el vuelto.

### Pagos combinados

Cada componente del pago deberá registrarse individualmente. El pedido se considerará completamente pagado cuando se hayan cubierto y verificado todos los importes correspondientes.

No habrá un sistema de cuotas ni de pagos parciales pendientes para completar en diferentes operaciones posteriores. El efectivo contra entrega constituye una modalidad de cobro diferida expresamente permitida.

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

Los pedidos que requieran cotización quedarán pendientes de confirmación del importe definitivo. La reserva de inventario durante la espera se regirá por las reglas de reservas de la sección 8; el plazo aplicable a estos pedidos específicos está por confirmar.

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

La reserva inicial expirará a los 20 minutos si el cliente no envía el comprobante de pago.

Si los administradores rechazan un comprobante enviado, el cliente dispondrá de 15 minutos adicionales para corregirlo y volver a enviarlo. Este rechazo no libera inventario: inicia la ventana de corrección.

El plazo máximo de 24 horas de la sección 14 corresponde a la gestión administrativa de los pedidos entrantes; no es la duración de la reserva de inventario.

El inventario reservado no podrá venderse a otro cliente.

Las reservas se liberán al cancelar o expirar un pedido. Cuando la ventana de corrección venza sin un comprobante válido, la reserva expirará y las unidades volverán a estar disponibles.

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

Como los productos ya están elaborados, no es obligatorio un estado de preparación posterior a la compra.

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

## 13. Notificaciones y comunicación

WhatsApp será el principal canal de comunicación.

No se integrará inicialmente WhatsApp Business API.

El panel permitirá abrir conversaciones mediante enlaces de WhatsApp con mensajes preparados.

Se utilizará Supabase Realtime para notificar a ambos administradores cuando:

- Se cree un pedido online.
- Se envíe un comprobante.
- Se produzcan actualizaciones relevantes de pedidos y pagos.

Las notificaciones serán informativas. La fuente de verdad siempre será la base de datos.

## 14. Horarios

La tienda aceptará pedidos las 24 horas.

El panel permitirá configurar los horarios de atención y preparación.

Los horarios informarán al cliente, pero no impedirán realizar pedidos fuera del horario habitual.

Los administradores tendrán un máximo de 24 horas para gestionar los pedidos entrantes y las operaciones pendientes. Este plazo es operativo y no define la duración de la reserva de inventario (sección 8).

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
- Definir la política comercial para pedidos con cotización de delivery.

Estos pendientes no impiden avanzar con el diseño visual ni con la arquitectura inicial, pero deberán resolverse antes de implementar los flujos afectados.

---

**Criterio general:** priorizar una solución sencilla, segura, mantenible y adecuada al volumen de un pequeño negocio. No introducir complejidad propia de plataformas grandes si no existe una necesidad real.
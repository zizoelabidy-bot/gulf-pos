# GULF POS 1.6.1

Unsigned Windows installer (Windows SmartScreen will warn: More info > Run anyway). Built on the open-source FloCafe project (MIT).

## What's new since 1.4.0
- Delivery management: delivery orders with address, driver and status tracking.
- Purchasing and suppliers: purchase orders, receiving into stock, supplier payments and balances (KWD, 3 decimals).
- Food cost: recipe costing and theoretical vs actual consumption.
- Delivery-app integration layer (Talabat, Keeta, Deliveroo, Jahez): settings, webhook intake, item mapping. Not yet tested against the real platforms; each needs your own platform credentials.
- New sky-blue look with the Cairo font and the official GULF CCTV logo ("Powered by GULF CCTV" on the login screen). Arabic RTL supported.
- Settings > Payments terminal (Tap SmartPOS for KNET/Visa/Mastercard): simulator mode for training and testing. Live mode needs a Tap merchant account, a SmartPOS terminal and API keys, and has not been tested against Tap yet. The POS payment screen is not connected to the terminal yet.

## Fixed in 1.6.1
- Payment screen no longer shows "calculating tax" forever when tax settings cannot be applied (for example taxes enabled without matching tax rules). It now shows a clear message: check tax settings or turn taxes off if not required.

## Known limits
- Installer is unsigned.
- Auto-update is not active in this release channel yet: install new versions from the release page.
- No dedicated curbside/car-pickup feature (takeaway orders only).

---

# GULF POS 1.6.1 (بالعربية)

مثبّت ويندوز غير موقّع رقمياً (سيظهر تحذير SmartScreen: More info ثم Run anyway).

## الجديد منذ 1.4.0
- إدارة التوصيل: طلبات توصيل بالعنوان والسائق وتتبع الحالة.
- المشتريات والموردون: أوامر شراء واستلام للمخزون ومدفوعات وأرصدة الموردين (دينار كويتي، 3 خانات).
- تكلفة الطعام: تكلفة الوصفات ومقارنة الاستهلاك النظري بالفعلي.
- طبقة ربط تطبيقات التوصيل (طلبات، كيتا، ديليفرو، جاهز): الإعدادات واستقبال الطلبات وربط الأصناف. لم تُجرَّب بعد على المنصات الحقيقية وتحتاج بيانات اعتماد منك لكل منصة.
- واجهة جديدة بالأزرق السماوي وخط Cairo وشعار GULF CCTV الرسمي، مع دعم العربية من اليمين لليسار.
- الإعدادات > جهاز البطاقات (Tap SmartPOS لكي نت وفيزا وماستركارد): وضع تجريبي للتدريب والاختبار. الوضع الفعلي يحتاج حساب تاجر Tap وجهاز SmartPOS ومفاتيح، ولم يُختبر مع Tap بعد. شاشة الدفع غير مربوطة بالجهاز حتى الآن.

## تم إصلاحه في 1.6.1
- شاشة الدفع لم تعد تعلق على "جارٍ حساب الضريبة". تظهر الآن رسالة واضحة: راجع إعدادات الضرائب أو عطّلها إن لم تكن مطلوبة.

## حدود معروفة
- المثبّت غير موقّع.
- التحديث التلقائي غير مفعّل في هذه القناة بعد: ثبّت الإصدارات الجديدة من صفحة الإصدار.
- لا توجد ميزة استلام من السيارة مخصصة (طلبات سفري فقط).

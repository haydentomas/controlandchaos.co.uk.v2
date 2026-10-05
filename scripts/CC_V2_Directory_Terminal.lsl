// Script: CC_V2_Directory_Terminal.lsl
// V2 PAYMENT TERMINAL: put this in a NEW separate test prim, not the avatar verifier or V1 kiosk.
// Keep one script in the prim; keep it owned by you, not group-deeded.
// First compile with the secret blank; report the object UUID; do not pay until setup is complete.
// Keep configured scripts private; never paste secrets into chat or commit them to the repository.
// Prices come from Supabase; unpriced/disabled plans cannot be purchased. All sales are final.
string PAYMENT_URL = "https://controlandchaosv2.netlify.app/.netlify/functions/directory-payment";
string ACCOUNT_URL = "https://controlandchaosv2.netlify.app/auth.html";
// IN-WORLD COPY ONLY: match CC_PAYMENT_KIOSK_SECRET in Netlify; use a separate 32+ character secret.
string KIOSK_SECRET = "";
string SCRIPT_VERSION = "payments-v1";

list PLAN_CODES = ["basic_monthly", "basic_lifetime", "vip_monthly", "vip_lifetime"];
list PLAN_LABELS = ["Basic Monthly", "Basic Lifetime", "VIP Monthly", "VIP Lifetime"];
list menuCodes = [];
list menuPrices = [];
list menuLabels = [];
key customer = NULL_KEY;
key catalogueRequest = NULL_KEY;
key paymentRequest = NULL_KEY;
string pendingReceipt = "";
string selectedPlan = "";
integer selectedAmount = 0;
integer listenHandle = 0;
integer menuChannel = 0;
integer sessionDeadline = 0;
integer requestDeadline = 0;
integer catalogueDeadline = 0;
integer nextRetry = 0;
integer blocked = FALSE;

hidePay()
{
    llSetPayPrice(PAY_HIDE, [PAY_HIDE, PAY_HIDE, PAY_HIDE, PAY_HIDE]);
}

closeSession()
{
    if (listenHandle != 0) llListenRemove(listenHandle);
    listenHandle = 0;
    customer = NULL_KEY;
    selectedPlan = "";
    selectedAmount = 0;
    sessionDeadline = 0;
    catalogueRequest = NULL_KEY;
    hidePay();
}

// Linkset data preserves receipts across resets; never clear it or delete a prim with unresolved payments.
string firstPending()
{
    list records = llLinksetDataFindKeys("^cc_v2_payment_", 0, 1);
    if (llGetListLength(records) == 0) return "";
    return llList2String(records, 0);
}

// Retrying the original payment reference prevents granting subscription time twice.
sendPending()
{
    if (blocked || paymentRequest != NULL_KEY || llStringLength(KIOSK_SECRET) < 32) return;
    pendingReceipt = firstPending();
    if (pendingReceipt == "") return;
    string payload = llLinksetDataRead(pendingReceipt);
    paymentRequest = llHTTPRequest(PAYMENT_URL,
        [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json", HTTP_CUSTOM_HEADER, "X-CC-Payment-Secret", KIOSK_SECRET], payload);
    requestDeadline = llGetUnixTime() + 60;
    nextRetry = llGetUnixTime() + 60;
}

retainUnexpectedPayment(key payer, integer amount)
{
    string reference = (string)llGenerateKey();
    string record = llList2Json(JSON_OBJECT, ["payer", (string)payer, "amount", amount, "selected_plan", selectedPlan, "status", "unapplied", "received_at", llGetUnixTime()]);
    string recordKey = "cc_v2_unapplied_" + reference;
    integer stored = llLinksetDataWrite(recordKey, record) == LINKSETDATA_OK;
    blocked = TRUE;
    hidePay();
    llOwnerSay("UNAPPLIED PAYMENT: receipt " + reference + ", payer " + (string)payer + ", L$" + (string)amount + ". Sales disabled pending reconciliation. No refund issued.");
    if (!stored) llOwnerSay("Receipt storage failed. Preserve the preceding payment details before resetting or deleting this object.");
    llRegionSayTo(payer, 0, "Payment received but not applied to a subscription. All sales are final; no refund has been issued. Receipt: " + reference + ". The owner has been notified; do not pay again.");
}

default
{
    state_entry()
    {
        closeSession();
        blocked = llGetListLength(llLinksetDataFindKeys("^cc_v2_unapplied_", 0, 1)) != 0 || llLinksetDataRead("cc_v2_payment_hold") != "";
        llSetClickAction(CLICK_ACTION_TOUCH);
        llSetText("Control & Chaos V2\nDirectory Subscriptions\nTouch for plans", <0.92, 0.86, 0.66>, 1.0);
        llOwnerSay("Directory terminal ready (" + SCRIPT_VERSION + "). Object UUID: " + (string)llGetKey());
        if (blocked) llOwnerSay("An unresolved payment is recorded. Sales are disabled until it is reconciled.");
        if (llStringLength(KIOSK_SECRET) < 32) llOwnerSay("Payments disabled: configure the private payment kiosk secret in-world and in Netlify.");
        else sendPending();
        llSetTimerEvent(5.0);
    }

    touch_start(integer count)
    {
        key avatar = llDetectedKey(0);
        if (llStringLength(KIOSK_SECRET) < 32 || blocked)
        {
            llRegionSayTo(avatar, 0, "Subscriptions are not available at this terminal yet.");
            return;
        }
        if (firstPending() != "")
        {
            llRegionSayTo(avatar, 0, "A payment is awaiting confirmation. Please try again shortly.");
            return;
        }
        if (customer != NULL_KEY && llGetUnixTime() < sessionDeadline)
        {
            llRegionSayTo(avatar, 0, "A selection is already open. Please wait up to a minute.");
            return;
        }
        if (llLinksetDataAvailable() < 4096)
        {
            llRegionSayTo(avatar, 0, "This terminal is temporarily unavailable.");
            llOwnerSay("Payment storage is low. Sales are disabled.");
            hidePay();
            return;
        }
        closeSession();
        customer = avatar;
        sessionDeadline = llGetUnixTime() + 60;
        catalogueDeadline = llGetUnixTime() + 30;
        catalogueRequest = llHTTPRequest(PAYMENT_URL,
            [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json", HTTP_CUSTOM_HEADER, "X-CC-Payment-Secret", KIOSK_SECRET],
            llList2Json(JSON_OBJECT, ["action", "plans", "avatar_uuid", (string)avatar]));
        llRegionSayTo(avatar, 0, "Checking available subscription plans...");
    }

    http_response(key request, integer status, list metadata, string body)
    {
        if (request == catalogueRequest && catalogueRequest != NULL_KEY)
        {
            catalogueRequest = NULL_KEY;
            if (status != 200 || llGetUnixTime() >= sessionDeadline)
            {
                llRegionSayTo(customer, 0, "Plans could not be loaded. No payment is required.");
                closeSession();
                return;
            }
            menuCodes = [];
            menuPrices = [];
            menuLabels = [];
            integer index;
            string summary = "All sales are final. No refunds.\nMonthly access lasts 30 days.\nDirectory subscription plans:\n";
            for (index = 0; index < 4; index++)
            {
                string planCode = llJsonGetValue(body, ["plans", index, "code"]);
                integer planIndex = llListFindList(PLAN_CODES, [planCode]);
                integer amount = (integer)llJsonGetValue(body, ["plans", index, "amount_linden"]);
                if (planIndex >= 0 && amount > 0)
                {
                    string label = llList2String(PLAN_LABELS, planIndex);
                    menuCodes += [planCode];
                    menuPrices += [amount];
                    menuLabels += [label];
                    summary += label + ": L$" + (string)amount + "\n";
                }
            }
            if (llGetListLength(menuCodes) == 0)
            {
                llRegionSayTo(customer, 0, "No purchasable plans are available. Prices may not be configured, or your account may already have lifetime access.");
                closeSession();
                return;
            }
            menuChannel = -100000 - (integer)llFrand(1000000000.0);
            listenHandle = llListen(menuChannel, "", customer, "");
            llDialog(customer, summary, menuLabels + ["Cancel"], menuChannel);
            return;
        }
        if (request != paymentRequest || paymentRequest == NULL_KEY) return;
        paymentRequest = NULL_KEY;
        string payload = llLinksetDataRead(pendingReceipt);
        key payer = (key)llJsonGetValue(payload, ["avatar_uuid"]);
        string reference = llJsonGetValue(payload, ["payment_reference"]);
        if (status == 200 && llJsonGetValue(body, ["payment_reference"]) == reference)
        {
            if (llLinksetDataDelete(pendingReceipt) != LINKSETDATA_OK)
            {
                blocked = TRUE;
                llOwnerSay("Confirmed payment receipt could not be cleared: " + reference + ". Sales disabled.");
            }
            llRegionSayTo(payer, 0, "Payment confirmed. " + llJsonGetValue(body, ["message"]) + " Account: " + ACCOUNT_URL);
            pendingReceipt = "";
        }
        else if (status == 400 || status == 403 || status == 409)
        {
            blocked = TRUE;
            llLinksetDataWrite("cc_v2_payment_hold", reference);
            llOwnerSay("Payment needs reconciliation. Receipt " + reference + ", status " + (string)status + ". Stored receipt retained; no refund issued.");
            llRegionSayTo(payer, 0, "Your payment is recorded locally but needs confirmation. Receipt: " + reference + ". The owner has been notified.");
        }
        else
        {
            llRegionSayTo(payer, 0, "Payment confirmation is delayed. The same receipt will be retried automatically; do not pay again.");
        }
    }

    listen(integer channel, string name, key avatar, string message)
    {
        if (avatar != customer || channel != menuChannel) return;
        if (message == "Cancel" || llGetUnixTime() >= sessionDeadline) { closeSession(); return; }
        integer index = llListFindList(menuLabels, [message]);
        if (index < 0) return;
        selectedPlan = llList2String(menuCodes, index);
        selectedAmount = llList2Integer(menuPrices, index);
        if (listenHandle != 0) llListenRemove(listenHandle);
        listenHandle = 0;
        llSetPayPrice(PAY_HIDE, [selectedAmount, PAY_HIDE, PAY_HIDE, PAY_HIDE]);
        llRegionSayTo(avatar, 0, "Right-click this terminal and Pay L$" + (string)selectedAmount + " for " + message + " before the selection expires. Monthly access lasts 30 days. All sales are final; no refunds.");
    }

    money(key payer, integer amount)
    {
        if (llStringLength(KIOSK_SECRET) < 32 || blocked || payer != customer || selectedPlan == "" || amount != selectedAmount || llGetUnixTime() >= sessionDeadline || firstPending() != "")
        {
            retainUnexpectedPayment(payer, amount);
            closeSession();
            return;
        }
        string reference = (string)llGenerateKey();
        string payload = llList2Json(JSON_OBJECT, ["action", "payment", "payment_reference", reference,
            "avatar_uuid", (string)payer, "plan", selectedPlan, "amount_linden", amount]);
        if (llLinksetDataWrite("cc_v2_payment_" + reference, payload) != LINKSETDATA_OK)
        {
            retainUnexpectedPayment(payer, amount);
            closeSession();
            return;
        }
        closeSession();
        llRegionSayTo(payer, 0, "Payment received. Confirming subscription; do not pay again. Receipt: " + reference);
        sendPending();
    }

    timer()
    {
        integer now = llGetUnixTime();
        if (customer != NULL_KEY && now >= sessionDeadline) closeSession();
        if (catalogueRequest != NULL_KEY && now >= catalogueDeadline)
        {
            llRegionSayTo(customer, 0, "Plan lookup timed out. No payment is required.");
            closeSession();
        }
        if (paymentRequest != NULL_KEY && now >= requestDeadline) paymentRequest = NULL_KEY;
        if (now >= nextRetry) sendPending();
    }

    changed(integer change)
    {
        if (change & CHANGED_OWNER)
        {
            hidePay();
            llSetScriptState(llGetScriptName(), FALSE);
        }
    }
}
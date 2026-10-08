// Script: CC_V2_Creator_Pass.lsl
// Companion to CC_V2_Directory_Terminal.lsl; handles creator offers and finance-alt payouts.
// Keep both scripts and CC_V2_Terminal_Config private. Never clear receipt data to recover a session.
string PAYMENT_URL = "https://controlandchaosv2.netlify.app/.netlify/functions/directory-payment";
string ACCOUNT_URL = "https://controlandchaosv2.netlify.app/auth.html";
string CONFIG_NOTECARD = "CC_V2_Terminal_Config";
string KIOSK_SECRET = "";
string VERIFICATION_SECRET = "";
string SCRIPT_VERSION = "creator-pass-v1";

key customer = NULL_KEY;
key creatorAvatar = NULL_KEY;
key offerRequest = NULL_KEY;
key paymentRequest = NULL_KEY;
key transferRequest = NULL_KEY;
key refundTransferRequest = NULL_KEY;
integer debitGranted = FALSE;
integer configurationReady = FALSE;
integer configurationDeadline = 0;
integer configLine = 0;
key configRequest = NULL_KEY;
string configPaymentSecret = "";
string configVerificationSecret = "";
string creatorPaymentKey = "";
string creatorPaymentAction = "";
string creatorName = "";
integer creatorPrice = 0;
integer creatorAmount = 0;
integer refundNeedsConfirm = FALSE;
integer blocked = FALSE;
integer modeDeadline = 0;
integer offerDeadline = 0;
integer paymentDeadline = 0;
integer nextRetry = 0;
integer listenHandle = 0;
integer menuChannel = 0;
integer mode = 0;
integer awaitingDebit = FALSE;
integer resumePreparedPayment = FALSE;
integer debitDeclined = FALSE;
string activeMarker = "";

integer validSecret(string value)
{
    integer length = llStringLength(value);
    if (length < 32 || length > 128) return FALSE;
    integer index;
    for (index = 0; index < length; index++)
    {
        integer character = llOrd(value, index);
        if (character < 33 || character > 126) return FALSE;
    }
    return TRUE;
}

string firstCreatorReceipt()
{
    list records = llLinksetDataFindKeys("^cc_v2_creator_payment_", 0, 1);
    if (llGetListLength(records) == 0) return "";
    return llList2String(records, 0);
}

integer hasOtherPending()
{
    return llLinksetDataRead("cc_v2_payment_hold") != "" ||
        llGetListLength(llLinksetDataFindKeys("^cc_v2_payment_", 0, 1)) != 0 ||
        llGetListLength(llLinksetDataFindKeys("^cc_v2_unapplied_", 0, 1)) != 0;
}

integer storePhase(string phase)
{
    string record = llLinksetDataRead(creatorPaymentKey);
    if (record == "") return FALSE;
    record = llJsonSetValue(record, ["phase"], phase);
    if (record == JSON_INVALID) return FALSE;
    return llLinksetDataWrite(creatorPaymentKey, record) == LINKSETDATA_OK;
}

string paymentBody(string action)
{
    string record = llLinksetDataRead(creatorPaymentKey);
    return llList2Json(JSON_OBJECT, ["action", action,
        "payment_reference", llJsonGetValue(record, ["payment_reference"]),
        "avatar_uuid", llJsonGetValue(record, ["avatar_uuid"]),
        "creator_avatar_uuid", llJsonGetValue(record, ["creator_avatar_uuid"]),
        "amount_linden", (integer)llJsonGetValue(record, ["amount_linden"]) ]);
}

sendCreatorRequest(string action)
{
    if (paymentRequest != NULL_KEY || llStringLength(KIOSK_SECRET) < 32) return;
    if (creatorPaymentKey == "") creatorPaymentKey = firstCreatorReceipt();
    if (creatorPaymentKey == "") return;
    creatorPaymentAction = action;
    paymentRequest = llHTTPRequest(PAYMENT_URL,
        [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json", HTTP_CUSTOM_HEADER, "X-CC-Payment-Secret", KIOSK_SECRET],
        paymentBody(action));
    paymentDeadline = llGetUnixTime() + 30;
    nextRetry = llGetUnixTime() + 60;
}

sendRefund()
{
    if (refundTransferRequest != NULL_KEY || !debitGranted) return;
    if (creatorPaymentKey == "") creatorPaymentKey = firstCreatorReceipt();
    if (creatorPaymentKey == "") return;
    string record = llLinksetDataRead(creatorPaymentKey);
    key payer = (key)llJsonGetValue(record, ["avatar_uuid"]);
    integer amount = (integer)llJsonGetValue(record, ["amount_linden"]);
    refundNeedsConfirm = llJsonGetValue(record, ["refund_confirm"]) == JSON_TRUE;
    if (payer == NULL_KEY || amount <= 0 || !storePhase("refund_transfer"))
    {
        blocked = TRUE;
        llOwnerSay("Creator-pass refund is blocked. Preserve receipt " + creatorPaymentKey + " for reconciliation.");
        return;
    }
    refundTransferRequest = llTransferLindenDollars(payer, amount);
    if (refundTransferRequest == NULL_KEY)
    {
        blocked = TRUE;
        storePhase("refund_failed");
        llOwnerSay("Creator-pass refund transfer could not start. Receipt retained for manual reconciliation.");
    }
}

continuePayment()
{
    if (creatorPaymentKey == "") creatorPaymentKey = firstCreatorReceipt();
    if (creatorPaymentKey == "") return;
    string phase = llJsonGetValue(llLinksetDataRead(creatorPaymentKey), ["phase"]);
    if (phase == "prepare") sendCreatorRequest("creator_blog_prepare");
    else if (phase == "start")
    {
        if (debitGranted && llGetPermissionsKey() == llGetOwner()) sendCreatorRequest("creator_blog_start");
        else if (!debitDeclined && !awaitingDebit)
        {
            blocked = TRUE;
            awaitingDebit = TRUE;
            resumePreparedPayment = TRUE;
            llOwnerSay("A prepared creator receipt is waiting for the finance owner's debit permission. No transfer has started.");
            llRequestPermissions(llGetOwner(), PERMISSION_DEBIT);
        }
    }
    else if (phase == "confirm") sendCreatorRequest("creator_blog_confirm");
    else if (phase == "cancel") sendCreatorRequest("creator_blog_cancel");
    else if (phase == "refund_confirm") sendCreatorRequest("creator_blog_refund_confirm");
    else if (phase == "refund_direct") sendRefund();
    else if (phase == "payout_uncertain") sendCreatorRequest("creator_blog_prepare");
    else if (phase == "forwarding" || phase == "refund_transfer" || phase == "refund_failed" || phase == "manual_reconciliation") blocked = TRUE;
}

clearReceipt()
{
    if (creatorPaymentKey != "") llLinksetDataDelete(creatorPaymentKey);
    creatorPaymentKey = "";
    creatorPaymentAction = "";
    creatorAmount = 0;
    refundNeedsConfirm = FALSE;
    blocked = hasOtherPending() || firstCreatorReceipt() != "";
    if (activeMarker != "" && llLinksetDataRead("cc_v2_creator_active") == activeMarker)
        llLinksetDataDelete("cc_v2_creator_active");
    activeMarker = "";
}

hidePay()
{
    llSetPayPrice(PAY_HIDE, [PAY_HIDE, PAY_HIDE, PAY_HIDE, PAY_HIDE]);
}

closeSession()
{
    if (listenHandle != 0) llListenRemove(listenHandle);
    listenHandle = 0;
    if (creatorPaymentKey == "" && !blocked && activeMarker != "" && llLinksetDataRead("cc_v2_creator_active") == activeMarker)
        llLinksetDataDelete("cc_v2_creator_active");
    if (creatorPaymentKey == "" && !blocked) activeMarker = "";
    customer = NULL_KEY;
    creatorAvatar = NULL_KEY;
    creatorName = "";
    creatorPrice = 0;
    awaitingDebit = FALSE;
    mode = 0;
    modeDeadline = 0;
    offerRequest = NULL_KEY;
    hidePay();
}

retainUnexpectedPayment(key payer, integer amount)
{
    string reference = (string)llGenerateKey();
    string record = llList2Json(JSON_OBJECT, ["payer", (string)payer, "amount", amount,
        "status", "unapplied", "received_at", llGetUnixTime(), "source", "creator_pass"]);
    string recordKey = "cc_v2_unapplied_" + reference;
    integer stored = llLinksetDataWrite(recordKey, record) == LINKSETDATA_OK;
    blocked = TRUE;
    closeSession();
    llOwnerSay("UNAPPLIED PAYMENT: receipt " + reference + ", payer " + (string)payer + ", L$" + (string)amount + ". Sales disabled pending reconciliation. No refund issued.");
    if (!stored) llOwnerSay("Receipt storage failed. Preserve the preceding payment details before resetting or deleting this object.");
    llRegionSayTo(payer, 0, "Payment received but not applied. Do not pay again. Receipt: " + reference + ". The owner has been notified.");
}

openCreatorPass(key avatar)
{
    if (!configurationReady || llStringLength(KIOSK_SECRET) < 32 || llStringLength(VERIFICATION_SECRET) < 32)
    {
        llRegionSayTo(avatar, 0, "Creator-pass configuration is loading or unavailable. Please try again later.");
        return;
    }
    if (blocked || hasOtherPending() || firstCreatorReceipt() != "" || llLinksetDataRead("cc_v2_creator_active") != "")
    {
        llRegionSayTo(avatar, 0, "A payment is being handled or reconciled. No new creator pass can be started yet.");
        return;
    }
    customer = avatar;
    activeMarker = (string)avatar + ":" + (string)llGetUnixTime();
    if (llLinksetDataWrite("cc_v2_creator_active", activeMarker) != LINKSETDATA_OK)
    {
        closeSession();
        llRegionSayTo(avatar, 0, "Creator-pass service is temporarily unavailable.");
        return;
    }
    mode = 1;
    modeDeadline = llGetUnixTime() + 60;
    menuChannel = -100000 - (integer)llFrand(1000000000.0);
    listenHandle = llListen(menuChannel, "", customer, "");
    llTextBox(customer, "Enter the creator's verified Second Life avatar UUID to view their monthly blog pass.", menuChannel);
}

loadOffer(key targetAvatar)
{
    if (creatorPaymentKey != "" || firstCreatorReceipt() != "")
    {
        llRegionSayTo(customer, 0, "A creator payment is awaiting reconciliation. No new payment can be taken.");
        closeSession();
        return;
    }
    creatorAvatar = targetAvatar;
    offerRequest = llHTTPRequest(PAYMENT_URL,
        [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json", HTTP_CUSTOM_HEADER, "X-CC-Payment-Secret", KIOSK_SECRET],
        llList2Json(JSON_OBJECT, ["action", "creator_blog_offer", "creator_avatar_uuid", (string)creatorAvatar]));
    offerDeadline = llGetUnixTime() + 30;
    mode = 2;
    llRegionSayTo(customer, 0, "Checking the creator's monthly pass...");
}

showPaymentPrompt()
{
    if (creatorPrice <= 0 || customer == NULL_KEY || creatorAvatar == NULL_KEY || llGetUnixTime() >= modeDeadline)
    {
        closeSession();
        return;
    }
    mode = 4;
    modeDeadline = llGetUnixTime() + 60;
    llSetPayPrice(PAY_HIDE, [creatorPrice, PAY_HIDE, PAY_HIDE, PAY_HIDE]);
    llRegionSayTo(customer, 0, "Right-click this terminal and pay exactly L$" + (string)creatorPrice + " for a 30-day creator pass. Do not pay more than once.");
}

loadConfiguration()
{
    configurationReady = FALSE;
    KIOSK_SECRET = "";
    VERIFICATION_SECRET = "";
    configPaymentSecret = "";
    configVerificationSecret = "";
    configLine = 0;
    if (llGetInventoryType(CONFIG_NOTECARD) != INVENTORY_NOTECARD)
    {
        llOwnerSay("Private configuration unavailable: missing CC_V2_Terminal_Config notecard.");
        return;
    }
    configurationDeadline = llGetUnixTime() + 60;
    configRequest = llGetNotecardLine(CONFIG_NOTECARD, configLine);
}

default
{
    state_entry()
    {
        hidePay();
        debitGranted = (llGetPermissions() & PERMISSION_DEBIT) && llGetPermissionsKey() == llGetOwner();
        activeMarker = llLinksetDataRead("cc_v2_creator_active");
        blocked = hasOtherPending() || firstCreatorReceipt() != "";
        llOwnerSay("Creator-pass helper ready (" + SCRIPT_VERSION + "). Object UUID: " + (string)llGetKey());
        if (activeMarker != "" && !blocked)
        {
            if (llLinksetDataDelete("cc_v2_creator_active") == LINKSETDATA_OK)
            {
                activeMarker = "";
                llOwnerSay("Cleared an abandoned creator-pass menu session; no payment receipt was present.");
            }
            else
            {
                blocked = TRUE;
                llOwnerSay("An abandoned creator-pass session marker could not be cleared. Creator-pass activity remains blocked.");
            }
        }
        else if (activeMarker != "")
            llOwnerSay("A creator-pass session marker and payment state already exist. Preserve receipts and reconcile before clearing anything.");
        loadConfiguration();
        llSetTimerEvent(5.0);
        continuePayment();
    }

    link_message(integer sender, integer number, string message, key id)
    {
        if (number == 4101) openCreatorPass((key)message);
    }

    dataserver(key request, string data)
    {
        if (request != configRequest || configRequest == NULL_KEY) return;
        if (data == EOF)
        {
            if (!validSecret(configPaymentSecret) || !validSecret(configVerificationSecret) || configPaymentSecret == configVerificationSecret)
            {
                configRequest = NULL_KEY;
                llOwnerSay("Private configuration unavailable: two distinct valid secrets are required.");
                return;
            }
            KIOSK_SECRET = configPaymentSecret;
            VERIFICATION_SECRET = configVerificationSecret;
            configPaymentSecret = "";
            configVerificationSecret = "";
            configRequest = NULL_KEY;
            configurationReady = TRUE;
            llOwnerSay("Creator-pass private configuration loaded.");
            continuePayment();
            return;
        }
        string line = llStringTrim(data, STRING_TRIM);
        if (line != "" && llGetSubString(line, 0, 0) != "#")
        {
            if (llJsonValueType(line, []) != JSON_OBJECT || llGetListLength(llJson2List(line)) != 2)
            {
                configRequest = NULL_KEY;
                llOwnerSay("Private configuration unavailable: invalid JSON at line " + (string)(configLine + 1));
                return;
            }
            string setting = llList2String(llJson2List(line), 0);
            if (llJsonValueType(line, [setting]) != JSON_STRING)
            {
                configRequest = NULL_KEY;
                llOwnerSay("Private configuration unavailable: secret values must be JSON strings.");
                return;
            }
            string value = llJsonGetValue(line, [setting]);
            if (!validSecret(value))
            {
                configRequest = NULL_KEY;
                llOwnerSay("Private configuration unavailable: invalid secret format at line " + (string)(configLine + 1));
                return;
            }
            if (setting == "CC_PAYMENT_KIOSK_SECRET" && configPaymentSecret == "") configPaymentSecret = value;
            else if (setting == "CC_VERIFICATION_KIOSK_SECRET" && configVerificationSecret == "") configVerificationSecret = value;
            else
            {
                configRequest = NULL_KEY;
                llOwnerSay("Private configuration unavailable: unknown or duplicate setting at line " + (string)(configLine + 1));
                return;
            }
        }
        configLine++;
        if (configLine > 20)
        {
            configRequest = NULL_KEY;
            llOwnerSay("Private configuration unavailable: notecard has too many lines.");
            return;
        }
        configurationDeadline = llGetUnixTime() + 60;
        configRequest = llGetNotecardLine(CONFIG_NOTECARD, configLine);
    }

    http_response(key request, integer status, list metadata, string body)
    {
        if (request == offerRequest && offerRequest != NULL_KEY)
        {
            offerRequest = NULL_KEY;
            string offeredAvatar = llJsonGetValue(body, ["offer", "creator_avatar_uuid"]);
            creatorPrice = (integer)llJsonGetValue(body, ["offer", "monthly_price_linden"]);
            creatorName = llJsonGetValue(body, ["offer", "creator_name"]);
            if (status != 200 || offeredAvatar != (string)creatorAvatar || creatorPrice <= 0 || llGetUnixTime() >= modeDeadline)
            {
                llRegionSayTo(customer, 0, "This creator has no active subscriber pass available. No payment is due.");
                closeSession();
                return;
            }
            mode = 3;
            modeDeadline = llGetUnixTime() + 60;
            llDialog(customer, creatorName + " monthly creator pass: L$" + (string)creatorPrice + ". Subscribe for 30 days?", ["Pay Pass", "Cancel"], menuChannel);
            return;
        }
        if (request != paymentRequest || paymentRequest == NULL_KEY) return;
        paymentRequest = NULL_KEY;
        string record = llLinksetDataRead(creatorPaymentKey);
        string reference = llJsonGetValue(record, ["payment_reference"]);
        key payer = (key)llJsonGetValue(record, ["avatar_uuid"]);
        creatorAvatar = (key)llJsonGetValue(record, ["creator_avatar_uuid"]);
        creatorAmount = (integer)llJsonGetValue(record, ["amount_linden"]);
        if (status == 200 && llJsonGetValue(body, ["payment_reference"]) == reference)
        {
            if (creatorPaymentAction == "creator_blog_prepare")
            {
                integer preparedAmount = (integer)llJsonGetValue(body, ["payout", "amount_linden"]);
                string preparedCreator = llJsonGetValue(body, ["payout", "creator_avatar_uuid"]);
                string preparedState = llJsonGetValue(body, ["payout", "payment_state"]);
                if (preparedCreator != (string)creatorAvatar || preparedAmount != creatorAmount)
                {
                    blocked = TRUE;
                    storePhase("manual_reconciliation");
                    llOwnerSay("Creator payment needs reconciliation before payout. Receipt: " + reference);
                    return;
                }
                if (preparedState != "prepared")
                {
                    blocked = TRUE;
                    storePhase("manual_reconciliation");
                    llOwnerSay("Creator receipt is in backend state " + preparedState + ". No transfer was retried. Reconcile receipt " + reference + " manually.");
                    return;
                }
                if (!storePhase("start"))
                {
                    blocked = TRUE;
                    storePhase("manual_reconciliation");
                    llOwnerSay("Could not persist creator payout state. Preserve receipt " + reference + " for reconciliation.");
                    return;
                }
                continuePayment();
                return;
            }
            if (creatorPaymentAction == "creator_blog_start")
            {
                if (llJsonGetValue(body, ["start_payout"]) != JSON_TRUE || !debitGranted || llGetPermissionsKey() != llGetOwner() || !storePhase("forwarding"))
                {
                    blocked = TRUE;
                    storePhase("manual_reconciliation");
                    llOwnerSay("Creator payout needs finance review. Receipt: " + reference);
                    llRegionSayTo(payer, 0, "Your payment is recorded. Payout needs finance review; do not pay again. Receipt: " + reference);
                    return;
                }
                transferRequest = llTransferLindenDollars(creatorAvatar, creatorAmount);
                if (transferRequest == NULL_KEY)
                {
                    storePhase("cancel");
                    sendCreatorRequest("creator_blog_cancel");
                }
                return;
            }
            if (creatorPaymentAction == "creator_blog_confirm")
            {
                clearReceipt();
                llRegionSayTo(payer, 0, "Creator subscription active for 30 days. Thank you. Account: " + ACCOUNT_URL);
                return;
            }
            if (creatorPaymentAction == "creator_blog_cancel")
            {
                if (llJsonGetValue(body, ["refund_required"]) == JSON_TRUE)
                {
                    record = llJsonSetValue(record, ["refund_confirm"], JSON_TRUE);
                    llLinksetDataWrite(creatorPaymentKey, record);
                    if (!storePhase("refund_direct"))
                    {
                        blocked = TRUE;
                        llOwnerSay("Refund state could not be saved. Preserve receipt " + reference + ".");
                        return;
                    }
                    sendRefund();
                }
                else
                {
                    blocked = TRUE;
                    storePhase("manual_reconciliation");
                    llOwnerSay("Creator cancellation needs manual reconciliation. Receipt: " + reference);
                }
                return;
            }
            if (creatorPaymentAction == "creator_blog_refund_confirm")
            {
                if (llJsonGetValue(body, ["refunded"]) == JSON_TRUE) clearReceipt();
                else blocked = TRUE;
                llRegionSayTo(payer, 0, "The creator transfer failed and your payment was returned. Receipt: " + reference);
                return;
            }
        }
        if (creatorPaymentAction == "creator_blog_prepare" && (status == 400 || status == 409))
        {
            record = llJsonSetValue(record, ["refund_confirm"], JSON_FALSE);
            llLinksetDataWrite(creatorPaymentKey, record);
            storePhase("refund_direct");
            sendRefund();
            return;
        }
        llRegionSayTo(payer, 0, "Creator payment confirmation is delayed. Do not pay again; the same receipt will be retried.");
    }

    listen(integer channel, string name, key avatar, string message)
    {
        if (avatar != customer || channel != menuChannel) return;
        if (llGetUnixTime() >= modeDeadline) { closeSession(); return; }
        if (message == "Cancel") { closeSession(); return; }
        if (mode == 1)
        {
            key target = (key)llStringTrim(message, STRING_TRIM);
            if (llStringLength(message) != 36 || target == NULL_KEY || target == avatar)
            {
                llRegionSayTo(avatar, 0, "Enter a valid creator avatar UUID different from your own.");
                closeSession();
                return;
            }
            loadOffer(target);
            return;
        }
        if (mode == 3 && message == "Pay Pass")
        {
            mode = 5;
            awaitingDebit = TRUE;
            llRegionSayTo(customer, 0, "Creator payout requires the finance-alt owner's debit permission. No payment is due yet.");
            llRequestPermissions(llGetOwner(), PERMISSION_DEBIT);
        }
    }

    money(key payer, integer amount)
    {
        if (activeMarker == "" || llLinksetDataRead("cc_v2_creator_active") != activeMarker) return;
        if (mode != 4 || !configurationReady || blocked || payer != customer || creatorAvatar == NULL_KEY || !debitGranted || amount != creatorPrice || llGetUnixTime() >= modeDeadline || firstCreatorReceipt() != "" || hasOtherPending())
        {
            retainUnexpectedPayment(payer, amount);
            return;
        }
        string reference = (string)llGenerateKey();
        creatorPaymentKey = "cc_v2_creator_payment_" + reference;
        string record = llList2Json(JSON_OBJECT, ["payment_reference", reference, "avatar_uuid", (string)payer,
            "creator_avatar_uuid", (string)creatorAvatar, "amount_linden", amount, "phase", "prepare", "refund_confirm", JSON_FALSE]);
        if (llLinksetDataWrite(creatorPaymentKey, record) != LINKSETDATA_OK)
        {
            retainUnexpectedPayment(payer, amount);
            return;
        }
        closeSession();
        llRegionSayTo(payer, 0, "Payment received. Preparing creator payout; do not pay again. Receipt: " + reference);
        sendCreatorRequest("creator_blog_prepare");
    }

    transaction_result(key transaction, integer success, string data)
    {
        if (transaction == transferRequest && transferRequest != NULL_KEY)
        {
            transferRequest = NULL_KEY;
            if (success)
            {
                if (!storePhase("confirm"))
                {
                    blocked = TRUE;
                    llOwnerSay("Creator payout succeeded but confirmation state could not be stored. Reconcile receipt " + creatorPaymentKey + ".");
                    return;
                }
                sendCreatorRequest("creator_blog_confirm");
            }
            else
            {
                if (!storePhase("cancel"))
                {
                    blocked = TRUE;
                    llOwnerSay("Creator payout failed but refund state could not be stored. Reconcile receipt " + creatorPaymentKey + ".");
                    return;
                }
                sendCreatorRequest("creator_blog_cancel");
            }
            return;
        }
        if (transaction == refundTransferRequest && refundTransferRequest != NULL_KEY)
        {
            refundTransferRequest = NULL_KEY;
            key payer = (key)llJsonGetValue(llLinksetDataRead(creatorPaymentKey), ["avatar_uuid"]);
            if (!success)
            {
                blocked = TRUE;
                storePhase("refund_failed");
                llOwnerSay("Refund transfer failed. Receipt " + creatorPaymentKey + " requires manual reconciliation.");
                return;
            }
            if (refundNeedsConfirm)
            {
                storePhase("refund_confirm");
                sendCreatorRequest("creator_blog_refund_confirm");
            }
            else
            {
                clearReceipt();
                llRegionSayTo(payer, 0, "Creator payment could not be prepared; your L$ payment was returned.");
            }
        }
    }

    run_time_permissions(integer permissions)
    {
        debitGranted = (permissions & PERMISSION_DEBIT) && llGetPermissionsKey() == llGetOwner();
        if (awaitingDebit)
        {
            awaitingDebit = FALSE;
            if (resumePreparedPayment)
            {
                resumePreparedPayment = FALSE;
                if (debitGranted && llGetPermissionsKey() == llGetOwner()) sendCreatorRequest("creator_blog_start");
                else
                {
                    debitDeclined = TRUE;
                    blocked = TRUE;
                    llOwnerSay("Prepared creator receipt remains held. Debit permission was not granted; no payout was started.");
                }
            }
            else if (debitGranted) showPaymentPrompt();
            else
            {
                debitDeclined = TRUE;
                llRegionSayTo(customer, 0, "Debit permission was not granted; no payment was requested.");
                closeSession();
            }
        }
    }

    timer()
    {
        integer now = llGetUnixTime();
        if (configRequest != NULL_KEY && now >= configurationDeadline)
        {
            configRequest = NULL_KEY;
            configurationReady = FALSE;
            KIOSK_SECRET = "";
            VERIFICATION_SECRET = "";
            llOwnerSay("Private configuration read timed out. Creator-pass service is disabled.");
        }
        if (customer != NULL_KEY && now >= modeDeadline) closeSession();
        if (offerRequest != NULL_KEY && now >= offerDeadline)
        {
            offerRequest = NULL_KEY;
            llRegionSayTo(customer, 0, "Creator offer lookup timed out. No payment is due.");
            closeSession();
        }
        if (paymentRequest != NULL_KEY && now >= paymentDeadline) paymentRequest = NULL_KEY;
        if (paymentRequest == NULL_KEY && creatorPaymentKey != "" && now >= nextRetry) continuePayment();
    }
}

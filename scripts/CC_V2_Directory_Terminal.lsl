// Script: CC_V2_Directory_Terminal.lsl
// V2 COMBINED TERMINAL: subscriptions and avatar verification in one prim; never replace the V1 kiosk.
// Keep one script in the prim; creator-pass forwarding requires it to be owned by the finance alt and not group-deeded.
// Keep the trusted owner/object settings synchronized with the finance alt's Netlify payment configuration.
// Keep configured scripts private; never paste secrets into chat or commit them to the repository.
// Create CC_V2_Terminal_Config in-world with one JSON line per secret; keep it private and out of deliveries.
// Leave both secret variables below blank: replacements load the existing notecard automatically.
// Prices come from Supabase; unpriced/disabled plans cannot be purchased. All sales are final.
string PAYMENT_URL = "https://controlandchaosv2.netlify.app/.netlify/functions/directory-payment";
string VERIFY_URL = "https://controlandchaosv2.netlify.app/.netlify/functions/verify-avatar";
string LOGIN_URL = "https://controlandchaosv2.netlify.app/.netlify/functions/terminal-login";
string REMINDER_URL = "https://controlandchaosv2.netlify.app/.netlify/functions/directory-reminders";
string ACCOUNT_URL = "https://controlandchaosv2.netlify.app/auth.html";
string CONFIG_NOTECARD = "CC_V2_Terminal_Config";
// Runtime only: populated from the private notecard, never from repository configuration.
string KIOSK_SECRET = "";
string VERIFICATION_SECRET = "";
string SCRIPT_VERSION = "directory-v4.2";

list PLAN_CODES = ["basic_monthly", "basic_lifetime", "vip_monthly", "vip_lifetime"];
list PLAN_LABELS = ["Basic Monthly", "Basic Lifetime", "VIP Monthly", "VIP Lifetime"];
list menuCodes = [];
list menuPrices = [];
list menuLabels = [];
key customer = NULL_KEY;
key catalogueRequest = NULL_KEY;
key paymentRequest = NULL_KEY;
key verificationRequest = NULL_KEY;
key verificationAvatar = NULL_KEY;
key accountRequest = NULL_KEY;
key accountAvatar = NULL_KEY;
key creatorOfferRequest = NULL_KEY;
key creatorPaymentRequest = NULL_KEY;
key creatorTransferRequest = NULL_KEY;
key creatorRefundTransferRequest = NULL_KEY;
key creatorPayer = NULL_KEY;
key creatorAvatar = NULL_KEY;
string pendingReceipt = "";
string creatorPaymentKey = "";
string creatorPaymentAction = "";
integer creatorAmount = 0;
integer creatorPrice = 0;
integer debitGranted = FALSE;
integer creatorOfferDeadline = 0;
integer creatorPaymentDeadline = 0;
integer creatorNextRetry = 0;
integer creatorRefundNeedsConfirm = FALSE;
string creatorPayLabel = "";
string creatorName = "";
string selectedPlan = "";
integer selectedAmount = 0;
integer listenHandle = 0;
integer menuChannel = 0;
integer sessionDeadline = 0;
integer requestDeadline = 0;
integer catalogueDeadline = 0;
integer nextRetry = 0;
integer blocked = FALSE;
integer verificationDeadline = 0;
integer accountDeadline = 0;
string menuMode = "";
key reminderRequest = NULL_KEY;
string reminderStage = "";
string reminderId = "";
string reminderToken = "";
integer reminderDeadline = 0;
integer nextReminderPoll = 0;
integer remindersPaused = FALSE;
key configRequest = NULL_KEY;
integer configLine = 0;
integer configDeadline = 0;
integer configurationReady = FALSE;
string configPaymentSecret = "";
string configVerificationSecret = "";

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
    menuMode = "";
    hidePay();
}

openMainMenu(key avatar)
{
    closeSession();
    customer = avatar;
    menuMode = "main";
    sessionDeadline = llGetUnixTime() + 60;
    menuChannel = -100000 - (integer)llFrand(1000000000.0);
    listenHandle = llListen(menuChannel, "", customer, "");
    llDialog(customer, "Control & Chaos V2 Terminal", ["Directory Plans", "Creator Pass", "Verify Avatar", "My Account", "Cancel"], menuChannel);
}

openCreatorPass()
{
    if (!debitGranted || llGetPermissionsKey() != llGetOwner())
    {
        llRegionSayTo(customer, 0, "Creator subscriptions are not available yet. The finance-alt owner must grant the terminal debit permission.");
        llOwnerSay("Creator-pass sales require the finance-alt owner to grant PERMISSION_DEBIT to this non-group-deeded terminal.");
        llRequestPermissions(llGetOwner(), PERMISSION_DEBIT);
        closeSession();
        return;
    }
    if (blocked || firstPending() != "" || firstCreatorPending() != "")
    {
        llRegionSayTo(customer, 0, "A previous payment is being reconciled. No new payments can be accepted yet.");
        closeSession();
        return;
    }
    menuMode = "creator_avatar";
    sessionDeadline = llGetUnixTime() + 60;
    llTextBox(customer, "Enter the creator's verified Second Life avatar UUID to view their monthly blog pass.", menuChannel);
}

loadCreatorOffer(key targetAvatar)
{
    if (llStringLength(KIOSK_SECRET) < 32 || blocked || firstCreatorPending() != "")
    {
        llRegionSayTo(customer, 0, "Creator passes are unavailable while a previous payment is being reconciled.");
        closeSession();
        return;
    }
    creatorAvatar = targetAvatar;
    creatorOfferRequest = llHTTPRequest(PAYMENT_URL,
        [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json", HTTP_CUSTOM_HEADER, "X-CC-Payment-Secret", KIOSK_SECRET],
        llList2Json(JSON_OBJECT, ["action", "creator_blog_offer", "creator_avatar_uuid", (string)creatorAvatar]));
    creatorOfferDeadline = llGetUnixTime() + 30;
    menuMode = "creator_offer_loading";
    llRegionSayTo(customer, 0, "Checking the creator's monthly pass...");
}

// Linkset data preserves receipts across resets; never clear it or delete a prim with unresolved payments.
string firstPending()
{
    list records = llLinksetDataFindKeys("^cc_v2_payment_", 0, 1);
    if (llGetListLength(records) == 0) return "";
    return llList2String(records, 0);
}

string firstCreatorPending()
{
    list records = llLinksetDataFindKeys("^cc_v2_creator_payment_", 0, 1);
    if (llGetListLength(records) == 0) return "";
    return llList2String(records, 0);
}

integer storeCreatorPhase(string phase)
{
    string record = llLinksetDataRead(creatorPaymentKey);
    if (record == "") return FALSE;
    record = llJsonSetValue(record, ["phase"], phase);
    if (record == JSON_INVALID) return FALSE;
    return llLinksetDataWrite(creatorPaymentKey, record) == LINKSETDATA_OK;
}

string creatorPaymentBody(string action)
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
    if (creatorPaymentRequest != NULL_KEY || llStringLength(KIOSK_SECRET) < 32) return;
    if (creatorPaymentKey == "") creatorPaymentKey = firstCreatorPending();
    if (creatorPaymentKey == "") return;
    creatorPaymentAction = action;
    creatorPaymentRequest = llHTTPRequest(PAYMENT_URL,
        [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json", HTTP_CUSTOM_HEADER, "X-CC-Payment-Secret", KIOSK_SECRET],
        creatorPaymentBody(action));
    creatorPaymentDeadline = llGetUnixTime() + 30;
    creatorNextRetry = llGetUnixTime() + 60;
}

sendCreatorRefund()
{
    if (creatorRefundTransferRequest != NULL_KEY || !debitGranted) return;
    if (creatorPaymentKey == "") creatorPaymentKey = firstCreatorPending();
    if (creatorPaymentKey == "") return;
    string record = llLinksetDataRead(creatorPaymentKey);
    key payer = (key)llJsonGetValue(record, ["avatar_uuid"]);
    integer amount = (integer)llJsonGetValue(record, ["amount_linden"]);
    creatorRefundNeedsConfirm = llJsonGetValue(record, ["refund_confirm"]) == JSON_TRUE;
    if (payer == NULL_KEY || amount <= 0 || !storeCreatorPhase("refund_transfer"))
    {
        blocked = TRUE;
        llOwnerSay("Creator-pass refund is blocked. Preserve receipt " + creatorPaymentKey + " for reconciliation.");
        return;
    }
    creatorRefundTransferRequest = llTransferLindenDollars(payer, amount);
    if (creatorRefundTransferRequest == NULL_KEY)
    {
        blocked = TRUE;
        storeCreatorPhase("refund_failed");
        llOwnerSay("Creator-pass refund transfer could not start. Receipt retained for manual reconciliation.");
    }
}

continueCreatorPayment()
{
    if (creatorPaymentKey == "") creatorPaymentKey = firstCreatorPending();
    if (creatorPaymentKey == "") return;
    string phase = llJsonGetValue(llLinksetDataRead(creatorPaymentKey), ["phase"]);
    if (phase == "prepare") sendCreatorRequest("creator_blog_prepare");
    else if (phase == "start") sendCreatorRequest("creator_blog_start");
    else if (phase == "confirm") sendCreatorRequest("creator_blog_confirm");
    else if (phase == "cancel") sendCreatorRequest("creator_blog_cancel");
    else if (phase == "refund_confirm") sendCreatorRequest("creator_blog_refund_confirm");
    else if (phase == "refund_direct") sendCreatorRefund();
    else if (phase == "forwarding" || phase == "refund_transfer" || phase == "refund_failed" || phase == "payout_uncertain")
    {
        blocked = TRUE;
    }
}

integer clearCreatorReceipt()
{
    if (creatorPaymentKey != "") llLinksetDataDelete(creatorPaymentKey);
    creatorPaymentKey = "";
    creatorPaymentAction = "";
    creatorPayer = NULL_KEY;
    creatorAvatar = NULL_KEY;
    creatorAmount = 0;
    creatorRefundNeedsConfirm = FALSE;
    blocked = llGetListLength(llLinksetDataFindKeys("^cc_v2_unapplied_", 0, 1)) != 0 || llLinksetDataRead("cc_v2_payment_hold") != "" || firstPending() != "";
    return TRUE;
}

loadPlans()
{
    if (llStringLength(KIOSK_SECRET) < 32 || blocked || firstPending() != "")
    {
        llRegionSayTo(customer, 0, "Subscriptions are unavailable or a payment is awaiting confirmation. Do not pay again.");
        closeSession();
        return;
    }
    if (llLinksetDataAvailable() < 4096)
    {
        llRegionSayTo(customer, 0, "This terminal is temporarily unavailable.");
        llOwnerSay("Payment storage is low. Sales are disabled.");
        closeSession();
        return;
    }
    if (listenHandle != 0) llListenRemove(listenHandle);
    listenHandle = 0;
    menuMode = "loading";
    sessionDeadline = llGetUnixTime() + 60;
    catalogueDeadline = llGetUnixTime() + 30;
    catalogueRequest = llHTTPRequest(PAYMENT_URL,
        [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json", HTTP_CUSTOM_HEADER, "X-CC-Payment-Secret", KIOSK_SECRET],
        llList2Json(JSON_OBJECT, ["action", "plans", "avatar_uuid", (string)customer]));
    llRegionSayTo(customer, 0, "Checking available subscription plans...");
}

openVerification()
{
    if (llStringLength(VERIFICATION_SECRET) < 32)
    {
        llRegionSayTo(customer, 0, "Avatar verification is not configured yet.");
        closeSession();
        return;
    }
    menuMode = "verify";
    sessionDeadline = llGetUnixTime() + 60;
    llTextBox(customer, "Paste the verification code from your own signed-in V2 account. Never enter a code supplied by another person.", menuChannel);
}

openAccount()
{
    if (llStringLength(VERIFICATION_SECRET) < 32)
    {
        llLoadURL(customer, "Open your V2 account; terminal sign-in is not configured yet", ACCOUNT_URL);
        closeSession();
        return;
    }
    accountAvatar = customer;
    accountRequest = llHTTPRequest(LOGIN_URL,
        [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json", HTTP_CUSTOM_HEADER, "X-CC-Kiosk-Secret", VERIFICATION_SECRET],
        llList2Json(JSON_OBJECT, ["action", "issue", "avatar_uuid", (string)accountAvatar]));
    accountDeadline = llGetUnixTime() + 30;
    closeSession();
    llRegionSayTo(accountAvatar, 0, "Preparing your private account link...");
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

sendReminderRequest(string stage, string payload)
{
    reminderStage = stage;
    reminderRequest = llHTTPRequest(REMINDER_URL,
        [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json", HTTP_CUSTOM_HEADER, "X-CC-Payment-Secret", KIOSK_SECRET], payload);
    reminderDeadline = llGetUnixTime() + 30;
    nextReminderPoll = llGetUnixTime() + 300;
}

// A submitted IM is not a recipient delivery receipt; retries acknowledge without sending it again.
pumpReminders()
{
    if (remindersPaused || reminderRequest != NULL_KEY || llStringLength(KIOSK_SECRET) < 32 || llGetUnixTime() < nextReminderPoll) return;
    string journal = llLinksetDataRead("cc_v2_reminder_journal");
    if (journal != "")
    {
        if (llJsonGetValue(journal, ["state"]) != "submitted")
        {
            remindersPaused = TRUE;
            llOwnerSay("Reminder submission was interrupted. Journal retained; not resending automatically. Payments remain available.");
            return;
        }
        sendReminderRequest("ack", llJsonGetValue(journal, ["ack"]));
        return;
    }
    if (customer != NULL_KEY || paymentRequest != NULL_KEY || verificationRequest != NULL_KEY || accountRequest != NULL_KEY || firstPending() != "") return;
    if (llLinksetDataAvailable() < 6144) return;
    sendReminderRequest("claim", llList2Json(JSON_OBJECT, ["action", "claim"]));
}

handleReminderResponse(integer status, string body)
{
    reminderRequest = NULL_KEY;
    if (status != 200)
    {
        if (reminderStage == "ack" && status == 409)
        {
            remindersPaused = TRUE;
            llOwnerSay("Reminder acknowledgement rejected. Journal retained for reconciliation; IM will not be resent automatically.");
        }
        else if (status == 403 || status == 404)
            llOwnerSay("Reminder service unavailable (HTTP " + (string)status + "). Retrying in five minutes.");
        return;
    }
    if (reminderStage == "ack")
    {
        if (llJsonGetValue(body, ["acknowledged"]) == JSON_TRUE)
        {
            if (llLinksetDataDelete("cc_v2_reminder_journal") != LINKSETDATA_OK)
            {
                remindersPaused = TRUE;
                llOwnerSay("Reminder journal could not be cleared; not sending further IMs.");
            }
            else nextReminderPoll = llGetUnixTime() + 15;
        }
        return;
    }
    if (llJsonGetValue(body, ["reminder"]) == JSON_NULL) return;
    if (reminderStage == "claim")
    {
        reminderId = llJsonGetValue(body, ["reminder", "id"]);
        reminderToken = llJsonGetValue(body, ["reminder", "claim_token"]);
        if (llStringLength(reminderId) != 36 || llStringLength(reminderToken) != 36) return;
        sendReminderRequest("authorize", llList2Json(JSON_OBJECT, ["action", "authorize", "id", reminderId, "claim_token", reminderToken]));
        return;
    }
    if (reminderStage != "authorize") return;
    string recipient = llJsonGetValue(body, ["reminder", "avatar_uuid"]);
    string message = llJsonGetValue(body, ["reminder", "message"]);
    if (llStringLength(recipient) != 36 || (key)recipient == NULL_KEY || message == JSON_INVALID || llStringLength(message) == 0 || llStringLength(message) > 1023) return;
    string ack = llList2Json(JSON_OBJECT, ["action", "ack", "id", reminderId, "claim_token", reminderToken]);
    string journal = llList2Json(JSON_OBJECT, ["state", "sending", "ack", ack]);
    if (llLinksetDataWrite("cc_v2_reminder_journal", journal) != LINKSETDATA_OK)
    {
        remindersPaused = TRUE;
        llOwnerSay("Reminder journal could not be stored; no IM sent. Payments remain available.");
        return;
    }
    llInstantMessage((key)recipient, message);
    journal = llList2Json(JSON_OBJECT, ["state", "submitted", "ack", ack]);
    if (llLinksetDataWrite("cc_v2_reminder_journal", journal) != LINKSETDATA_OK)
    {
        remindersPaused = TRUE;
        llOwnerSay("Reminder IM submitted but journal update failed. Do not clear linkset data or resend manually without checking.");
    }
    sendReminderRequest("ack", ack);
}

integer validConfigSecret(string value)
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

configurationFailed(string reason)
{
    configRequest = NULL_KEY;
    configurationReady = FALSE;
    KIOSK_SECRET = "";
    VERIFICATION_SECRET = "";
    configPaymentSecret = "";
    configVerificationSecret = "";
    hidePay();
    llOwnerSay("Private configuration unavailable: " + reason + ". Authenticated services are disabled; stored receipts are retained.");
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
        configurationFailed("missing CC_V2_Terminal_Config notecard");
        return;
    }
    configDeadline = llGetUnixTime() + 60;
    configRequest = llGetNotecardLine(CONFIG_NOTECARD, configLine);
    llOwnerSay("Loading private terminal configuration...");
}

default
{
    state_entry()
    {
        closeSession();
        debitGranted = (llGetPermissions() & PERMISSION_DEBIT) && llGetPermissionsKey() == llGetOwner();
        if (!debitGranted) llRequestPermissions(llGetOwner(), PERMISSION_DEBIT);
        blocked = llGetListLength(llLinksetDataFindKeys("^cc_v2_unapplied_", 0, 1)) != 0 || llLinksetDataRead("cc_v2_payment_hold") != "" || firstCreatorPending() != "";
        llSetClickAction(CLICK_ACTION_TOUCH);
        llSetText("Control & Chaos V2\nDirectory Terminal\nTouch for subscriptions or verification", <0.92, 0.86, 0.66>, 1.0);
        llOwnerSay("Directory terminal ready (" + SCRIPT_VERSION + "). Object UUID: " + (string)llGetKey());
        if (blocked) llOwnerSay("An unresolved payment is recorded. Sales are disabled until it is reconciled.");
        loadConfiguration();
        nextReminderPoll = llGetUnixTime() + 60;
        llSetTimerEvent(5.0);
    }

    dataserver(key request, string data)
    {
        if (configRequest == NULL_KEY || request != configRequest) return;
        if (data == EOF)
        {
            if (!validConfigSecret(configPaymentSecret) || !validConfigSecret(configVerificationSecret) || configPaymentSecret == configVerificationSecret)
            {
                configurationFailed("two distinct secrets of 32-128 printable non-space ASCII characters are required");
                return;
            }
            KIOSK_SECRET = configPaymentSecret;
            VERIFICATION_SECRET = configVerificationSecret;
            configPaymentSecret = "";
            configVerificationSecret = "";
            configRequest = NULL_KEY;
            configurationReady = TRUE;
            llOwnerSay("Private configuration loaded. Terminal services are ready.");
            sendPending();
            continueCreatorPayment();
            return;
        }
        string line = llStringTrim(data, STRING_TRIM);
        if (line != "" && llGetSubString(line, 0, 0) != "#")
        {
            if (llJsonValueType(line, []) != JSON_OBJECT)
            {
                configurationFailed("invalid JSON at line " + (string)(configLine + 1));
                return;
            }
            list entries = llJson2List(line);
            if (llGetListLength(entries) != 2)
            {
                configurationFailed("each JSON line must contain exactly one setting");
                return;
            }
            string setting = llList2String(entries, 0);
            if (llJsonValueType(line, [setting]) != JSON_STRING)
            {
                configurationFailed("secret values must be JSON strings");
                return;
            }
            string value = llJsonGetValue(line, [setting]);
            if (!validConfigSecret(value))
            {
                configurationFailed("invalid secret format at line " + (string)(configLine + 1));
                return;
            }
            if (setting == "CC_PAYMENT_KIOSK_SECRET" && configPaymentSecret == "") configPaymentSecret = value;
            else if (setting == "CC_VERIFICATION_KIOSK_SECRET" && configVerificationSecret == "") configVerificationSecret = value;
            else
            {
                configurationFailed("unknown or duplicate setting at line " + (string)(configLine + 1));
                return;
            }
        }
        configLine++;
        if (configLine > 20)
        {
            configurationFailed("notecard has too many lines");
            return;
        }
        configDeadline = llGetUnixTime() + 60;
        configRequest = llGetNotecardLine(CONFIG_NOTECARD, configLine);
    }

    touch_start(integer count)
    {
        key avatar = llDetectedKey(0);
        if (!configurationReady)
        {
            llRegionSayTo(avatar, 0, "Terminal configuration is loading or unavailable. Please try again later.");
            return;
        }
        if (accountRequest != NULL_KEY)
        {
            llRegionSayTo(avatar, 0, "An account link is being prepared. Please try again shortly.");
            return;
        }
        if (verificationRequest != NULL_KEY)
        {
            llRegionSayTo(avatar, 0, "Avatar verification is awaiting a response. Please try again shortly.");
            return;
        }
        if (customer != NULL_KEY && llGetUnixTime() < sessionDeadline)
        {
            llRegionSayTo(avatar, 0, "A selection is already open. Please wait up to a minute.");
            return;
        }
        openMainMenu(avatar);
    }

    http_response(key request, integer status, list metadata, string body)
    {
        if (request == reminderRequest && reminderRequest != NULL_KEY)
        {
            handleReminderResponse(status, body);
            return;
        }
        if (request == accountRequest && accountRequest != NULL_KEY)
        {
            accountRequest = NULL_KEY;
            string url = llJsonGetValue(body, ["url"]);
            string tokenPrefix = ACCOUNT_URL + "#terminal_token=";
            integer validLogin = llSubStringIndex(url, tokenPrefix) == 0 && llStringLength(url) == llStringLength(tokenPrefix) + 64;
            if (status == 200 && (validLogin || url == ACCOUNT_URL + "#terminal_setup=1"))
                llLoadURL(accountAvatar, "Private sign-in link: open now, do not share. Login links expire in two minutes.", url);
            else
            {
                string reason = "Account service unavailable.";
                if (status == 403) reason = "Terminal authentication denied; check the verification secret, owner and object settings.";
                else if (status == 404) reason = "Terminal login endpoint is not deployed at this address.";
                else if (status == 429) reason = "Account-link request limit reached; wait before trying again.";
                else if (status == 200) reason = "Account service returned an unexpected link format.";
                llRegionSayTo(accountAvatar, 0, "Account link unavailable (HTTP " + (string)status + "). " + reason + " Your account has not been deleted by this request. You can sign in at " + ACCOUNT_URL);
                llOwnerSay("My Account request failed (HTTP " + (string)status + "). " + reason);
            }
            accountAvatar = NULL_KEY;
            accountDeadline = 0;
            return;
        }
        if (request == verificationRequest && verificationRequest != NULL_KEY)
        {
            if (status == 200) llRegionSayTo(verificationAvatar, 0, "Avatar linked. Return to your V2 account and press Refresh verification.");
            else llRegionSayTo(verificationAvatar, 0, "Verification failed (status " + (string)status + "). The code may be expired/used or the avatar already linked.");
            verificationRequest = NULL_KEY;
            verificationAvatar = NULL_KEY;
            verificationDeadline = 0;
            closeSession();
            return;
        }
        if (request == creatorOfferRequest && creatorOfferRequest != NULL_KEY)
        {
            creatorOfferRequest = NULL_KEY;
            string offeredAvatar = llJsonGetValue(body, ["offer", "creator_avatar_uuid"]);
            integer amount = (integer)llJsonGetValue(body, ["offer", "monthly_price_linden"]);
            creatorName = llJsonGetValue(body, ["offer", "creator_name"]);
            if (status != 200 || offeredAvatar != (string)creatorAvatar || amount <= 0 || llGetUnixTime() >= sessionDeadline)
            {
                llRegionSayTo(customer, 0, "This creator has no active subscriber pass available. No payment is due.");
                closeSession();
                return;
            }
            creatorPrice = amount;
            menuMode = "creator_confirm";
            sessionDeadline = llGetUnixTime() + 60;
            llDialog(customer, creatorName + " monthly creator pass: L$" + (string)creatorPrice + ". Payment goes to the creator through this finance terminal. Subscribe for 30 days?", ["Pay Pass", "Cancel"], menuChannel);
            return;
        }
        if (request == creatorPaymentRequest && creatorPaymentRequest != NULL_KEY)
        {
            creatorPaymentRequest = NULL_KEY;
            string record = llLinksetDataRead(creatorPaymentKey);
            string reference = llJsonGetValue(record, ["payment_reference"]);
            creatorPayer = (key)llJsonGetValue(record, ["avatar_uuid"]);
            creatorAvatar = (key)llJsonGetValue(record, ["creator_avatar_uuid"]);
            creatorAmount = (integer)llJsonGetValue(record, ["amount_linden"]);
            if (status == 200 && llJsonGetValue(body, ["payment_reference"]) == reference)
            {
                if (creatorPaymentAction == "creator_blog_prepare")
                {
                    string preparedCreator = llJsonGetValue(body, ["payment", "creator_avatar_uuid"]);
                    integer preparedAmount = (integer)llJsonGetValue(body, ["payment", "amount_linden"]);
                    if (preparedCreator != (string)creatorAvatar || preparedAmount != creatorAmount || !storeCreatorPhase("start"))
                    {
                        blocked = TRUE;
                        storeCreatorPhase("payout_uncertain");
                        llOwnerSay("Creator payment receipt needs reconciliation before any payout: " + reference);
                        return;
                    }
                    sendCreatorRequest("creator_blog_start");
                    return;
                }
                if (creatorPaymentAction == "creator_blog_start")
                {
                    if (llJsonGetValue(body, ["start_payout"]) != JSON_TRUE || !debitGranted || llGetPermissionsKey() != llGetOwner())
                    {
                        blocked = TRUE;
                        storeCreatorPhase("payout_uncertain");
                        llOwnerSay("Creator payout was not started or needs reconciliation. Receipt: " + reference);
                        llRegionSayTo(creatorPayer, 0, "Your payment is recorded. Creator payout needs finance review; do not pay again. Receipt: " + reference);
                        return;
                    }
                    if (!storeCreatorPhase("forwarding"))
                    {
                        blocked = TRUE;
                        llOwnerSay("Could not persist payout state. Do not retry or reset this terminal. Receipt: " + reference);
                        return;
                    }
                    creatorTransferRequest = llTransferLindenDollars(creatorAvatar, creatorAmount);
                    if (creatorTransferRequest == NULL_KEY)
                    {
                        storeCreatorPhase("cancel");
                        sendCreatorRequest("creator_blog_cancel");
                    }
                    return;
                }
                if (creatorPaymentAction == "creator_blog_confirm")
                {
                    if (!clearCreatorReceipt())
                    {
                        blocked = TRUE;
                        llOwnerSay("Creator access is confirmed but local receipt cleanup failed: " + reference);
                    }
                    llRegionSayTo(creatorPayer, 0, "Creator subscription active for 30 days. Thank you. Account: " + ACCOUNT_URL);
                    return;
                }
                if (creatorPaymentAction == "creator_blog_cancel")
                {
                    if (llJsonGetValue(body, ["refund_required"]) == JSON_TRUE)
                    {
                        record = llJsonSetValue(record, ["refund_confirm"], JSON_TRUE);
                        llLinksetDataWrite(creatorPaymentKey, record);
                        if (!storeCreatorPhase("refund_direct"))
                        {
                            blocked = TRUE;
                            llOwnerSay("Refund state could not be saved. Receipt retained for manual reconciliation: " + reference);
                            return;
                        }
                        sendCreatorRefund();
                    }
                    else
                    {
                        blocked = TRUE;
                        storeCreatorPhase("payout_uncertain");
                        llOwnerSay("Creator payment cancellation needs manual reconciliation: " + reference);
                    }
                    return;
                }
                if (creatorPaymentAction == "creator_blog_refund_confirm")
                {
                    if (llJsonGetValue(body, ["refunded"]) == JSON_TRUE) clearCreatorReceipt();
                    else blocked = TRUE;
                    llRegionSayTo(creatorPayer, 0, "The creator transfer failed and your payment was returned. Receipt: " + reference);
                    return;
                }
            }
            if (creatorPaymentAction == "creator_blog_prepare" && (status == 400 || status == 409))
            {
                record = llJsonSetValue(record, ["refund_confirm"], JSON_FALSE);
                llLinksetDataWrite(creatorPaymentKey, record);
                storeCreatorPhase("refund_direct");
                sendCreatorRefund();
                return;
            }
            llRegionSayTo(creatorPayer, 0, "Creator payment confirmation is delayed. Do not pay again; the same receipt will be retried.");
            return;
        }
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
            menuMode = "plans";
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
        if (llGetUnixTime() >= sessionDeadline) { closeSession(); return; }
        if (menuMode == "creator_avatar")
        {
            key targetAvatar = (key)llStringTrim(message, STRING_TRIM);
            if (llStringLength(message) != 36 || targetAvatar == NULL_KEY || targetAvatar == avatar)
            {
                llRegionSayTo(avatar, 0, "Enter a valid creator avatar UUID that is different from your own.");
                closeSession();
                return;
            }
            loadCreatorOffer(targetAvatar);
            return;
        }
        if (menuMode == "verify")
        {
            string code = llStringTrim(message, STRING_TRIM);
            string username = llGetUsername(avatar);
            if (llStringLength(code) != 36 || (key)code == NULL_KEY || username == "")
            {
                llRegionSayTo(avatar, 0, "Invalid verification code or username unavailable. Request a code from your own V2 account.");
                closeSession();
                return;
            }
            if (listenHandle != 0) llListenRemove(listenHandle);
            listenHandle = 0;
            verificationAvatar = avatar;
            verificationRequest = llHTTPRequest(VERIFY_URL,
                [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json", HTTP_CUSTOM_HEADER, "X-CC-Kiosk-Secret", VERIFICATION_SECRET],
                llList2Json(JSON_OBJECT, ["code", code, "avatar_uuid", (string)avatar, "username", username]));
            verificationDeadline = llGetUnixTime() + 60;
            menuMode = "verifying";
            return;
        }
        if (message == "Cancel") { closeSession(); return; }
        if (menuMode == "main")
        {
            if (message == "Directory Plans") loadPlans();
            else if (message == "Creator Pass") openCreatorPass();
            else if (message == "Verify Avatar") openVerification();
            else if (message == "My Account")
            {
                openAccount();
            }
            return;
        }
        if (menuMode == "creator_confirm")
        {
            if (message != "Pay Pass") return;
            if (!debitGranted || creatorPrice <= 0)
            {
                llRegionSayTo(avatar, 0, "Creator-pass forwarding is not ready. Do not pay this terminal yet.");
                closeSession();
                return;
            }
            selectedAmount = creatorPrice;
            menuMode = "creator_pay";
            sessionDeadline = llGetUnixTime() + 60;
            llSetPayPrice(PAY_HIDE, [selectedAmount, PAY_HIDE, PAY_HIDE, PAY_HIDE]);
            llRegionSayTo(avatar, 0, "Right-click the finance terminal and pay exactly L$" + (string)selectedAmount + " for a 30-day creator pass. The finance alt forwards this amount to the creator; access begins only after the transfer confirms.");
            return;
        }
        if (menuMode != "plans") return;
        integer index = llListFindList(menuLabels, [message]);
        if (index < 0) return;
        selectedPlan = llList2String(menuCodes, index);
        selectedAmount = llList2Integer(menuPrices, index);
        if (listenHandle != 0) llListenRemove(listenHandle);
        listenHandle = 0;
        menuMode = "pay";
        llSetPayPrice(PAY_HIDE, [selectedAmount, PAY_HIDE, PAY_HIDE, PAY_HIDE]);
        llRegionSayTo(avatar, 0, "Right-click this terminal and Pay L$" + (string)selectedAmount + " for " + message + " before the selection expires. Monthly access lasts 30 days. All sales are final; no refunds.");
    }

    money(key payer, integer amount)
    {
        if (menuMode == "creator_pay")
        {
            if (llStringLength(KIOSK_SECRET) < 32 || blocked || payer != customer || creatorAvatar == NULL_KEY || !debitGranted || amount != creatorPrice || llGetUnixTime() >= sessionDeadline || firstPending() != "" || firstCreatorPending() != "")
            {
                retainUnexpectedPayment(payer, amount);
                closeSession();
                return;
            }
            string reference = (string)llGenerateKey();
            creatorPaymentKey = "cc_v2_creator_payment_" + reference;
            string record = llList2Json(JSON_OBJECT, ["payment_reference", reference, "avatar_uuid", (string)payer,
                "creator_avatar_uuid", (string)creatorAvatar, "amount_linden", amount, "phase", "prepare", "refund_confirm", JSON_FALSE]);
            if (llLinksetDataWrite(creatorPaymentKey, record) != LINKSETDATA_OK)
            {
                retainUnexpectedPayment(payer, amount);
                closeSession();
                return;
            }
            creatorPayer = payer;
            creatorAmount = amount;
            closeSession();
            llRegionSayTo(payer, 0, "Payment received. Preparing creator payout; do not pay again. Receipt: " + reference);
            sendCreatorRequest("creator_blog_prepare");
            return;
        }
        if (llStringLength(KIOSK_SECRET) < 32 || blocked || menuMode != "pay" || payer != customer || selectedPlan == "" || amount != selectedAmount || llGetUnixTime() >= sessionDeadline || firstPending() != "")
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

    transaction_result(key transaction, integer success, string data)
    {
        if (transaction == creatorTransferRequest && creatorTransferRequest != NULL_KEY)
        {
            creatorTransferRequest = NULL_KEY;
            if (success)
            {
                if (!storeCreatorPhase("confirm"))
                {
                    blocked = TRUE;
                    llOwnerSay("Creator payout succeeded but confirmation state could not be stored. Reconcile receipt " + creatorPaymentKey + " before resetting the terminal.");
                    return;
                }
                sendCreatorRequest("creator_blog_confirm");
            }
            else
            {
                if (!storeCreatorPhase("cancel"))
                {
                    blocked = TRUE;
                    llOwnerSay("Creator payout failed but refund state could not be stored. Reconcile receipt " + creatorPaymentKey + ".");
                    return;
                }
                sendCreatorRequest("creator_blog_cancel");
            }
            return;
        }
        if (transaction == creatorRefundTransferRequest && creatorRefundTransferRequest != NULL_KEY)
        {
            creatorRefundTransferRequest = NULL_KEY;
            key payer = (key)llJsonGetValue(llLinksetDataRead(creatorPaymentKey), ["avatar_uuid"]);
            if (!success)
            {
                blocked = TRUE;
                storeCreatorPhase("refund_failed");
                llOwnerSay("Refund transfer failed. Receipt " + creatorPaymentKey + " requires manual reconciliation.");
                llRegionSayTo(payer, 0, "The creator transfer failed and your refund needs manual reconciliation. The finance manager has been notified.");
                return;
            }
            if (creatorRefundNeedsConfirm)
            {
                storeCreatorPhase("refund_confirm");
                sendCreatorRequest("creator_blog_refund_confirm");
            }
            else
            {
                clearCreatorReceipt();
                llRegionSayTo(payer, 0, "Creator payment could not be prepared; your L$ payment was returned.");
            }
        }
    }

    timer()
    {
        integer now = llGetUnixTime();
        if (configRequest != NULL_KEY && now >= configDeadline) configurationFailed("notecard read timed out");
        if (accountRequest != NULL_KEY && now >= accountDeadline)
        {
            llRegionSayTo(accountAvatar, 0, "Account link request timed out. Wait a minute before trying again, or sign in at " + ACCOUNT_URL);
            accountRequest = NULL_KEY;
            accountAvatar = NULL_KEY;
            accountDeadline = 0;
        }
        if (verificationRequest != NULL_KEY && now >= verificationDeadline)
        {
            llRegionSayTo(verificationAvatar, 0, "Verification response timed out. Refresh your V2 account before requesting another code.");
            verificationRequest = NULL_KEY;
            verificationAvatar = NULL_KEY;
            verificationDeadline = 0;
            closeSession();
        }
        if (customer != NULL_KEY && now >= sessionDeadline) closeSession();
        if (catalogueRequest != NULL_KEY && now >= catalogueDeadline)
        {
            llRegionSayTo(customer, 0, "Plan lookup timed out. No payment is required.");
            closeSession();
        }
        if (paymentRequest != NULL_KEY && now >= requestDeadline) paymentRequest = NULL_KEY;
        if (now >= nextRetry) sendPending();
        if (creatorOfferRequest != NULL_KEY && now >= creatorOfferDeadline)
        {
            creatorOfferRequest = NULL_KEY;
            llRegionSayTo(customer, 0, "Creator offer lookup timed out. No payment is due.");
            closeSession();
        }
        if (creatorPaymentRequest != NULL_KEY && now >= creatorPaymentDeadline) creatorPaymentRequest = NULL_KEY;
        if (creatorPaymentRequest == NULL_KEY && creatorPaymentKey != "" && now >= creatorNextRetry) continueCreatorPayment();
        if (reminderRequest != NULL_KEY && now >= reminderDeadline) reminderRequest = NULL_KEY;
        pumpReminders();
    }

    changed(integer change)
    {
        if (change & CHANGED_OWNER)
        {
            hidePay();
            llSetScriptState(llGetScriptName(), FALSE);
        }
        else if (change & CHANGED_INVENTORY) llResetScript();
    }

    run_time_permissions(integer permissions)
    {
        debitGranted = (permissions & PERMISSION_DEBIT) && llGetPermissionsKey() == llGetOwner();
        if (debitGranted) llOwnerSay("Finance-alt debit permission granted. Creator-pass forwarding is enabled.");
        else llOwnerSay("Finance-alt debit permission was not granted. Creator-pass payments remain disabled.");
    }
}
// Script: CC_V2_Avatar_Verifier.lsl
// V2 AVATAR VERIFIER: links an avatar to a website account; it does NOT take subscription payments.
// Keep this in its existing separate prim; do not replace it with the payment terminal script.
// Keep the prim owned by you, not group-deeded; keep configured scripts private.
// Never paste secrets into chat or commit them to the repository; keep the repository copy blank.
// Re-rezzing may change the object UUID; update CC_VERIFICATION_KIOSK_OBJECT in Netlify if it changes.
string VERIFY_URL = "https://controlandchaosv2.netlify.app/.netlify/functions/verify-avatar";
// IN-WORLD COPY ONLY: match CC_VERIFICATION_KIOSK_SECRET in Netlify, not CC_PAYMENT_KIOSK_SECRET.
string KIOSK_SECRET = "";
string SCRIPT_VERSION = "v3";

integer listenHandle;
integer dialogChannel;
integer expiresAt;
key activeAvatar;
key requestId;
integer touchCount;

resetSession()
{
    if (listenHandle != 0) llListenRemove(listenHandle);
    listenHandle = 0;
    dialogChannel = 0;
    activeAvatar = NULL_KEY;
    requestId = NULL_KEY;
    expiresAt = 0;
    llSetTimerEvent(0.0);
}

default
{
    state_entry()
    {
        resetSession();
        touchCount = 0;
        llSetClickAction(CLICK_ACTION_TOUCH);
        llSetText("Control & Chaos V2\nAvatar Verification\nTouch to verify", <0.92, 0.86, 0.66>, 1.0);
        llOwnerSay("Verifier ready (" + SCRIPT_VERSION + "). Object UUID: " + (string)llGetKey());
        if (llStringLength(KIOSK_SECRET) < 32) llOwnerSay("Configure the kiosk secret directly in this script and Netlify before use.");
    }

    touch_start(integer count)
    {
        touchCount++;
        key avatar = llDetectedKey(0);
        llOwnerSay("Touch #" + (string)touchCount + " from " + llDetectedName(0));

        if (llStringLength(KIOSK_SECRET) < 32) { llRegionSayTo(avatar, 0, "Verification is not configured yet."); return; }

        integer now = llGetUnixTime();
        if (activeAvatar != NULL_KEY && activeAvatar != avatar && now < expiresAt)
        {
            llRegionSayTo(avatar, 0, "The verifier is busy. Please try again shortly.");
            return;
        }

        resetSession();
        activeAvatar = avatar;
        dialogChannel = -100000 - (integer)llFrand(1000000000.0);
        listenHandle = llListen(dialogChannel, "", activeAvatar, "");
        expiresAt = llGetUnixTime() + 60;
        llSetTimerEvent(5.0);
        llTextBox(activeAvatar, "Paste the code from your own signed-in V2 account. This links this avatar to that account; never use a code someone else gave you.", dialogChannel);
    }

    listen(integer channel, string name, key avatar, string message)
    {
        if (avatar != activeAvatar || channel != dialogChannel) return;
        string code = llStringTrim(message, STRING_TRIM);
        if (llStringLength(code) != 36 || (key)code == NULL_KEY) { llRegionSayTo(avatar, 0, "Invalid verification code."); resetSession(); return; }
        string username = llGetUsername(avatar);
        if (username == "") { llRegionSayTo(avatar, 0, "Unable to resolve your username. Try again."); resetSession(); return; }
        if (listenHandle != 0) llListenRemove(listenHandle);
        listenHandle = 0;
        string payload = llList2Json(JSON_OBJECT, ["code", code, "avatar_uuid", (string)avatar, "username", username]);
        requestId = llHTTPRequest(VERIFY_URL, [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json", HTTP_CUSTOM_HEADER, "X-CC-Kiosk-Secret", KIOSK_SECRET], payload);
        expiresAt = llGetUnixTime() + 60;
    }

    http_response(key request, integer status, list metadata, string body)
    {
        if (request != requestId) return;
        if (status == 200) llRegionSayTo(activeAvatar, 0, "Avatar linked. Return to your V2 account and press Refresh verification.");
        else llRegionSayTo(activeAvatar, 0, "Verification failed (status " + (string)status + "). The code may be expired/used, the avatar already linked, or the verifier unavailable. Request a fresh code if appropriate.");
        resetSession();
    }

    timer()
    {
        if (expiresAt != 0 && llGetUnixTime() >= expiresAt) resetSession();
    }

    changed(integer change)
    {
        if (change & CHANGED_OWNER) llResetScript();
    }
}
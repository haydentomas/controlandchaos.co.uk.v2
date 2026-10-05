string VERIFY_URL = "https://controlandchaosv2.netlify.app/.netlify/functions/verify-avatar";
string KIOSK_SECRET = "";

integer listenHandle;
integer dialogChannel;
integer expiresAt;
key activeAvatar;
key requestId;

clearDialog()
{
    if (listenHandle != 0) llListenRemove(listenHandle);
    listenHandle = 0;
    activeAvatar = NULL_KEY;
    expiresAt = 0;
    llSetTimerEvent(0.0);
}

default
{
    state_entry()
    {
        llSetClickAction(CLICK_ACTION_TOUCH);
        llSetText("Control & Chaos V2\nAvatar Verification\nTouch to verify", <0.92, 0.86, 0.66>, 1.0);
        llOwnerSay("Verifier object UUID: " + (string)llGetKey());
        if (llStringLength(KIOSK_SECRET) < 32) llOwnerSay("Configure the kiosk secret directly in this script and Netlify before use.");
    }

    touch_start(integer count)
    {
        key avatar = llDetectedKey(0);
        if (llStringLength(KIOSK_SECRET) < 32) { llRegionSayTo(avatar, 0, "Verification is not configured yet."); return; }
        if (activeAvatar != NULL_KEY || requestId != NULL_KEY) { llRegionSayTo(avatar, 0, "The verifier is busy. Please try again shortly."); return; }
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
        if (llStringLength(code) != 36 || (key)code == NULL_KEY) { llRegionSayTo(avatar, 0, "Invalid verification code."); clearDialog(); return; }
        string username = llGetUsername(avatar);
        if (username == "") { llRegionSayTo(avatar, 0, "Unable to resolve your username. Try again."); clearDialog(); return; }
        string payload = llList2Json(JSON_OBJECT, ["code", code, "avatar_uuid", (string)avatar, "username", username]);
        requestId = llHTTPRequest(VERIFY_URL, [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json", HTTP_CUSTOM_HEADER, "X-CC-Kiosk-Secret", KIOSK_SECRET], payload);
        expiresAt = llGetUnixTime() + 60;
        if (listenHandle != 0) llListenRemove(listenHandle);
        listenHandle = 0;
    }

    http_response(key request, integer status, list metadata, string body)
    {
        if (request != requestId) return;
        requestId = NULL_KEY;
        if (status == 200) llRegionSayTo(activeAvatar, 0, "Avatar linked. Return to your V2 account and press Refresh verification.");
        else llRegionSayTo(activeAvatar, 0, "Verification failed. The code may be expired/used, the avatar already linked, or the verifier unavailable. Request a fresh code if appropriate.");
        clearDialog();
    }

    timer()
    {
        if (expiresAt != 0 && llGetUnixTime() >= expiresAt) { requestId = NULL_KEY; clearDialog(); }
    }

    changed(integer change)
    {
        if (change & CHANGED_OWNER) llResetScript();
    }
}
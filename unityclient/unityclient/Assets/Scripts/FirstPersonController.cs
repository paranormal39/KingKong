using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// FirstPersonController - full arena control kit on CharacterController + the
/// new Input System. The server is authoritative for damage / cooldowns / HP;
/// this just reports inputs and plays local feedback.
///
///   WASD  move            Mouse look           Space jump
///   LMB   primary fire    RMB   secondary/ADS  R     reload
///   F     tactical        E     special        Shift movement (dash)
///   Q     ultimate        V     melee          Ctrl  crouch / slide
///   1 / 2 weapon switch   Esc   release cursor
///
/// Input is ignored while the cursor is unlocked or chat is focused.
/// </summary>
[RequireComponent(typeof(CharacterController))]
public class FirstPersonController : MonoBehaviour
{
    public float moveSpeed = 7f;
    public float crouchSpeed = 3.5f;
    public float lookSensitivity = 0.08f;
    public float jumpHeight = 1.4f;
    public float gravity = -19.6f;
    public Transform cameraTransform;

    public float primaryInterval = 0.12f;   // client send cadence (server enforces real rate)
    public float secondaryInterval = 0.5f;
    public float shootRange = 85f;

    CharacterController cc;
    float pitch, velocityY;
    bool isDead, crouching;
    float lastPrimary, lastSecondary, lastMelee;

    // movement-ability dash impulse
    float dashUntil;
    Vector3 dashDir;
    const float DashDuration = 0.15f;
    const float DashSpeed = 48f;

    float baseFov = 75f, adsFov = 55f;

    // position reporting
    float sendTimer, keepaliveTimer;
    Vector3 lastSentPos;
    bool lastSentCrouch;
    const float SendInterval = 0.1f, KeepaliveInterval = 2f, MinMoveDelta = 0.01f;

    void Start()
    {
        cc = GetComponent<CharacterController>();
        cc.height = 1.8f;
        cc.center = new Vector3(0, 0.9f, 0);

        if (cameraTransform == null)
        {
            var camGo = new GameObject("PlayerCamera");
            camGo.transform.SetParent(transform, false);
            camGo.transform.localPosition = new Vector3(0, 1.65f, 0);
            var cam = camGo.AddComponent<Camera>();
            cam.fieldOfView = baseFov;
            camGo.tag = "MainCamera";
            camGo.AddComponent<AudioListener>();
            cameraTransform = camGo.transform;
        }

        foreach (var c in FindObjectsByType<Camera>(FindObjectsSortMode.None))
            if (c.transform != cameraTransform) c.gameObject.SetActive(false);
        foreach (var al in FindObjectsByType<AudioListener>(FindObjectsSortMode.None))
            if (al.transform != cameraTransform) al.enabled = false;

        var net = GameNetwork.Instance;
        if (net != null) { net.OnDied += HandleDied; net.OnRespawned += RespawnAt; }

        LockCursor(true);
    }

    void OnDestroy()
    {
        var net = GameNetwork.Instance;
        if (net != null) { net.OnDied -= HandleDied; net.OnRespawned -= RespawnAt; }
    }

    void HandleDied(string killerName) => isDead = true;

    void Update()
    {
        var kb = Keyboard.current;
        var mouse = Mouse.current;
        if (kb == null || mouse == null) return;

        if (kb.escapeKey.wasPressedThisFrame) LockCursor(false);
        else if (Cursor.lockState != CursorLockMode.Locked
                 && mouse.leftButton.wasPressedThisFrame
                 && !GameUI.ChatFocused
                 && UnityEngine.EventSystems.EventSystem.current != null
                 && !UnityEngine.EventSystems.EventSystem.current.IsPointerOverGameObject())
            LockCursor(true);

        bool playing = Cursor.lockState == CursorLockMode.Locked && !GameUI.ChatFocused && !isDead;
        var net = GameNetwork.Instance;

        // Look
        if (playing)
        {
            var delta = mouse.delta.ReadValue() * lookSensitivity;
            transform.Rotate(0, delta.x, 0);
            pitch = Mathf.Clamp(pitch - delta.y, -85f, 85f);
            cameraTransform.localEulerAngles = new Vector3(pitch, 0, 0);
        }

        // Aim-down-sights (hold RMB) - FOV only
        bool ads = playing && mouse.rightButton.isPressed;
        var cam = cameraTransform.GetComponent<Camera>();
        if (cam != null) cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, ads ? adsFov : baseFov, 12f * Time.deltaTime);

        if (playing && net != null)
        {
            // Primary fire (LMB)
            if (mouse.leftButton.isPressed && Time.time - lastPrimary >= primaryInterval)
            { lastPrimary = Time.time; FireWeapon(false); }

            // Secondary fire (RMB click)
            if (mouse.rightButton.wasPressedThisFrame && Time.time - lastSecondary >= secondaryInterval)
            { lastSecondary = Time.time; FireWeapon(true); }

            // Reload / melee / weapon switch
            if (kb.rKey.wasPressedThisFrame) net.Reload();
            if (kb.vKey.wasPressedThisFrame && Time.time - lastMelee >= 0.7f) { lastMelee = Time.time; MeleeAttack(); }
            if (kb.digit1Key.wasPressedThisFrame) net.SwitchWeapon(0);
            if (kb.digit2Key.wasPressedThisFrame) net.SwitchWeapon(1);

            // Abilities
            if (kb.fKey.wasPressedThisFrame) net.UseAbility("tactical");
            if (kb.eKey.wasPressedThisFrame) net.UseAbility("special");
            if (kb.qKey.wasPressedThisFrame) net.UseAbility("ultimate");
            if (kb.leftShiftKey.wasPressedThisFrame || kb.rightShiftKey.wasPressedThisFrame)
            {
                net.UseAbility("movement");
                dashUntil = Time.time + DashDuration;
                dashDir = transform.forward;
            }
        }

        // Crouch / slide (Ctrl)
        crouching = playing && (kb.leftCtrlKey.isPressed || kb.rightCtrlKey.isPressed);
        cc.height = Mathf.Lerp(cc.height, crouching ? 1.1f : 1.8f, 10f * Time.deltaTime);
        cc.center = new Vector3(0, cc.height * 0.5f, 0);

        // Camera height: sink while dead, lower while crouched
        float targetCamY = isDead ? 0.4f : (crouching ? 1.05f : 1.65f);
        var camPos = cameraTransform.localPosition;
        camPos.y = Mathf.Lerp(camPos.y, targetCamY, 8f * Time.deltaTime);
        cameraTransform.localPosition = camPos;

        // Move
        var mv = Vector2.zero;
        if (playing)
        {
            if (kb.wKey.isPressed) mv.y += 1;
            if (kb.sKey.isPressed) mv.y -= 1;
            if (kb.dKey.isPressed) mv.x += 1;
            if (kb.aKey.isPressed) mv.x -= 1;
            mv = Vector2.ClampMagnitude(mv, 1f);
        }

        float speed = crouching ? crouchSpeed : moveSpeed;
        var move = (transform.forward * mv.y + transform.right * mv.x) * speed;

        // Dash impulse from the movement ability
        if (Time.time < dashUntil) move += dashDir * DashSpeed;

        if (cc.isGrounded)
        {
            velocityY = -2f;
            if (playing && kb.spaceKey.wasPressedThisFrame) velocityY = Mathf.Sqrt(jumpHeight * -2f * gravity);
        }
        velocityY += gravity * Time.deltaTime;
        move.y = velocityY;
        cc.Move(move * Time.deltaTime);

        // Report position + crouch
        sendTimer += Time.deltaTime;
        keepaliveTimer += Time.deltaTime;
        if (sendTimer >= SendInterval)
        {
            sendTimer = 0f;
            bool moved = (transform.position - lastSentPos).sqrMagnitude > MinMoveDelta * MinMoveDelta;
            if (moved || crouching != lastSentCrouch || keepaliveTimer >= KeepaliveInterval)
            {
                keepaliveTimer = 0f;
                lastSentPos = transform.position;
                lastSentCrouch = crouching;
                net?.SendMove(transform.position, transform.eulerAngles.y, crouching);
            }
        }
    }

    void FireWeapon(bool secondary)
    {
        var net = GameNetwork.Instance;
        if (net == null || !net.alive) return;

        var origin = cameraTransform.position;
        var dir = cameraTransform.forward;
        Vector3 hitPoint = origin + dir * shootRange;
        string targetId = null;

        if (Physics.Raycast(origin, dir, out var hit, shootRange))
        {
            hitPoint = hit.point;
            var tag = hit.collider.GetComponentInParent<RemotePlayerTag>();
            if (tag != null) targetId = tag.playerId;
        }

        if (secondary) net.SecondaryFire(targetId);
        else net.PrimaryFire(targetId);

        FireTracer(origin + dir * 0.5f + cameraTransform.right * 0.1f - Vector3.up * 0.15f, hitPoint,
            secondary ? new Color(1f, 0.5f, 0.2f) : new Color(1f, 0.9f, 0.2f));
    }

    void MeleeAttack()
    {
        var net = GameNetwork.Instance;
        if (net == null) return;
        string targetId = null;
        if (Physics.Raycast(cameraTransform.position, cameraTransform.forward, out var hit, 3.5f))
        {
            var tag = hit.collider.GetComponentInParent<RemotePlayerTag>();
            if (tag != null) targetId = tag.playerId;
        }
        net.Melee(targetId);
    }

    void FireTracer(Vector3 from, Vector3 to, Color color)
    {
        var go = new GameObject("Tracer");
        var lr = go.AddComponent<LineRenderer>();
        lr.positionCount = 2;
        lr.SetPosition(0, from);
        lr.SetPosition(1, to);
        lr.startWidth = 0.03f;
        lr.endWidth = 0.03f;
        var shader = Shader.Find("Universal Render Pipeline/Unlit");
        if (shader == null) shader = Shader.Find("Unlit/Color");
        lr.material = new Material(shader);
        lr.startColor = lr.endColor = color;
        Destroy(go, 0.08f);
    }

    void RespawnAt(Vector3 pos)
    {
        cc.enabled = false;
        transform.position = pos;
        pitch = 0; velocityY = 0;
        cc.enabled = true;
        isDead = false;
    }

    static void LockCursor(bool locked)
    {
        Cursor.lockState = locked ? CursorLockMode.Locked : CursorLockMode.None;
        Cursor.visible = !locked;
    }
}

using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// FirstPersonController - WASD + mouse look + jump, built on
/// CharacterController and the new Input System.
///
/// Controls:
///   WASD  - move          Mouse - look
///   Space - jump          Esc   - release/capture cursor
///
/// Input is ignored while the cursor is unlocked or the chat box is focused,
/// so typing in chat never moves the player.
/// </summary>
[RequireComponent(typeof(CharacterController))]
public class FirstPersonController : MonoBehaviour
{
    public float moveSpeed = 7f;
    public float lookSensitivity = 0.08f; // degrees per pixel of mouse delta
    public float jumpHeight = 1.4f;
    public float gravity = -19.6f;
    public Transform cameraTransform;

    public float fireInterval = 0.3f; // matches server FIRE_INTERVAL_MS
    public float shootRange = 60f;    // matches server SHOT_RANGE

    CharacterController cc;
    float pitch;
    float velocityY;
    bool isDead;
    float lastShotAt;

    // Position reporting to the server (10 Hz while moving, 0.5 Hz keepalive)
    float sendTimer;
    float keepaliveTimer;
    Vector3 lastSentPos;
    const float SendInterval = 0.1f;
    const float KeepaliveInterval = 2f;
    const float MinMoveDelta = 0.01f;

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
            cam.fieldOfView = 75f;
            camGo.tag = "MainCamera";
            camGo.AddComponent<AudioListener>();
            cameraTransform = camGo.transform;
        }

        // Only one camera/audio listener should be active
        foreach (var c in FindObjectsByType<Camera>(FindObjectsSortMode.None))
            if (c.transform != cameraTransform) c.gameObject.SetActive(false);
        foreach (var al in FindObjectsByType<AudioListener>(FindObjectsSortMode.None))
            if (al.transform != cameraTransform) al.enabled = false;

        // Death / respawn wiring (server-authoritative)
        var net = GameNetwork.Instance;
        if (net != null)
        {
            net.OnDied += HandleDied;
            net.OnRespawned += RespawnAt;
        }

        LockCursor(true);
    }

    void OnDestroy()
    {
        var net = GameNetwork.Instance;
        if (net != null)
        {
            net.OnDied -= HandleDied;
            net.OnRespawned -= RespawnAt;
        }
    }

    void HandleDied(string killerName)
    {
        isDead = true;
    }

    void Update()
    {
        var kb = Keyboard.current;
        var mouse = Mouse.current;
        if (kb == null || mouse == null) return;

        // Esc releases the cursor (for UI/chat); click re-captures it
        if (kb.escapeKey.wasPressedThisFrame)
            LockCursor(false);
        else if (Cursor.lockState != CursorLockMode.Locked
                 && mouse.leftButton.wasPressedThisFrame
                 && !GameUI.ChatFocused
                 && UnityEngine.EventSystems.EventSystem.current != null
                 && !UnityEngine.EventSystems.EventSystem.current.IsPointerOverGameObject())
            LockCursor(true);

        bool playing = Cursor.lockState == CursorLockMode.Locked && !GameUI.ChatFocused && !isDead;

        // Look
        if (playing)
        {
            var delta = mouse.delta.ReadValue() * lookSensitivity;
            transform.Rotate(0, delta.x, 0);
            pitch = Mathf.Clamp(pitch - delta.y, -85f, 85f);
            cameraTransform.localEulerAngles = new Vector3(pitch, 0, 0);
        }

        // Shoot
        if (playing && mouse.leftButton.wasPressedThisFrame
            && Time.time - lastShotAt >= fireInterval)
        {
            lastShotAt = Time.time;
            Shoot();
        }

        // Camera sinks while dead
        var targetCamY = isDead ? 0.4f : 1.65f;
        var camPos = cameraTransform.localPosition;
        camPos.y = Mathf.Lerp(camPos.y, targetCamY, 6f * Time.deltaTime);
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

        var move = (transform.forward * mv.y + transform.right * mv.x) * moveSpeed;

        // Gravity + jump
        if (cc.isGrounded)
        {
            velocityY = -2f;
            if (playing && kb.spaceKey.wasPressedThisFrame)
                velocityY = Mathf.Sqrt(jumpHeight * -2f * gravity);
        }
        velocityY += gravity * Time.deltaTime;
        move.y = velocityY;

        cc.Move(move * Time.deltaTime);

        // Report position to the server
        sendTimer += Time.deltaTime;
        keepaliveTimer += Time.deltaTime;
        if (sendTimer >= SendInterval)
        {
            sendTimer = 0f;
            bool moved = (transform.position - lastSentPos).sqrMagnitude > MinMoveDelta * MinMoveDelta;
            if (moved || keepaliveTimer >= KeepaliveInterval)
            {
                keepaliveTimer = 0f;
                lastSentPos = transform.position;
                GameNetwork.Instance?.SendMove(transform.position, transform.eulerAngles.y);
            }
        }
    }

    /// <summary>
    /// Raycast from the crosshair; if it hits a remote player, report the
    /// shot to the server (which validates range/rate and applies damage).
    /// </summary>
    void Shoot()
    {
        var cam = cameraTransform;
        var origin = cam.position;
        var dir = cam.forward;

        Vector3 hitPoint = origin + dir * shootRange;
        if (Physics.Raycast(origin, dir, out var hit, shootRange))
        {
            hitPoint = hit.point;
            var tag = hit.collider.GetComponentInParent<RemotePlayerTag>();
            if (tag != null)
                GameNetwork.Instance?.SendShoot(tag.playerId);
        }

        FireTracer(origin + dir * 0.5f + cam.right * 0.1f - Vector3.up * 0.15f, hitPoint);
    }

    void FireTracer(Vector3 from, Vector3 to)
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
        lr.startColor = lr.endColor = new Color(1f, 0.9f, 0.2f);
        Destroy(go, 0.08f);
    }

    /// <summary>Teleport to the server-assigned respawn point.</summary>
    void RespawnAt(Vector3 pos)
    {
        cc.enabled = false;
        transform.position = pos;
        pitch = 0;
        velocityY = 0;
        cc.enabled = true;
        isDead = false;
    }

    static void LockCursor(bool locked)
    {
        Cursor.lockState = locked ? CursorLockMode.Locked : CursorLockMode.None;
        Cursor.visible = !locked;
    }
}

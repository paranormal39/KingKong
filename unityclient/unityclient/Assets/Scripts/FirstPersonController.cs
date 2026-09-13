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

    CharacterController cc;
    float pitch;
    float velocityY;

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

        LockCursor(true);
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

        bool playing = Cursor.lockState == CursorLockMode.Locked && !GameUI.ChatFocused;

        // Look
        if (playing)
        {
            var delta = mouse.delta.ReadValue() * lookSensitivity;
            transform.Rotate(0, delta.x, 0);
            pitch = Mathf.Clamp(pitch - delta.y, -85f, 85f);
            cameraTransform.localEulerAngles = new Vector3(pitch, 0, 0);
        }

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

    static void LockCursor(bool locked)
    {
        Cursor.lockState = locked ? CursorLockMode.Locked : CursorLockMode.None;
        Cursor.visible = !locked;
    }
}

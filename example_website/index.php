<?php
    // AE2 Web Terminal url
    $AE2_SERVER_HOST = "http://localhost:2324/";
    // Is the public mode enabled on the server
    $AE2_IS_PUBLIC_MODE = true;
    // Immediate proxy IPs allowed to supply X-Forwarded-Proto. Add remote proxies explicitly.
    // These proxies must preserve the public Host (including its port) and overwrite this header.
    $AE2_TRUSTED_PROXIES = ['127.0.0.1', '::1'];
    // Mirror the mod's own state, which this proxy cannot ask: true only when icons have been uploaded to the
    // server (/ae2webicons export in-game), and when it runs GregTech with gregtech.enabled. Left false, the terminal
    // falls back to generated item tiles and hides the GregTech pages.
    $AE2_HAS_ITEM_ICONS = false;
    $AE2_HAS_GT = false;

    function cookieOptions($expires, $httpOnly) {
        return [
            'expires' => $expires,
            'httponly' => $httpOnly,
            'samesite' => 'Lax',
        ];
    }

    function clearSessionCookies() {
        foreach (['authenticationToken', 'username', 'isAdmin', 'isOutdated'] as $name) {
            setcookie($name, '', cookieOptions(time() - 3600, $name === 'authenticationToken'));
        }
    }

    function apiError($code, $status) {
        header('Content-Type: application/json; charset=UTF-8');
        header('Cache-Control: no-store');
        http_response_code($code);
        if ($code === 401) header('WWW-Authenticate: Bearer');
        echo json_encode(['status' => $status, 'data' => null]);
        exit;
    }

    function isSameOriginForm() {
        global $AE2_TRUSTED_PROXIES;
        if (isset($_SERVER['HTTP_SEC_FETCH_SITE'])) {
            return in_array($_SERVER['HTTP_SEC_FETCH_SITE'], ['same-origin', 'none'], true);
        }
        // Nonbrowser clients may omit both browser-origin headers.
        if (!isset($_SERVER['HTTP_ORIGIN'])) return true;
        $origin = parse_url($_SERVER['HTTP_ORIGIN']);
        $scheme = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http';
        if (isset($_SERVER['HTTP_X_FORWARDED_PROTO'])
                && in_array($_SERVER['REMOTE_ADDR'] ?? '', $AE2_TRUSTED_PROXIES, true)) {
            $scheme = strtolower(trim($_SERVER['HTTP_X_FORWARDED_PROTO']));
            if (!in_array($scheme, ['http', 'https'], true)) return false;
        }
        $expected = parse_url($scheme . '://' . ($_SERVER['HTTP_HOST'] ?? ''));
        return is_array($origin) && is_array($expected)
            && isset($origin['scheme'], $origin['host'], $expected['host'])
            && !isset($origin['user']) && !isset($origin['pass'])
            && !isset($origin['path']) && !isset($origin['query']) && !isset($origin['fragment'])
            && strtolower($origin['scheme']) === $scheme
            && strcasecmp($origin['host'], $expected['host']) === 0
            && ($origin['port'] ?? ($scheme === 'https' ? 443 : 80))
                === ($expected['port'] ?? ($scheme === 'https' ? 443 : 80));
    }

    function upstreamRequest($url, $method, $headers, $body) {
        $responseHeaders = [];
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HEADERFUNCTION, function($ch, $line) use (&$responseHeaders) {
            $parts = explode(':', $line, 2);
            if (count($parts) === 2 && in_array(strtolower(trim($parts[0])),
                    ['content-type', 'allow', 'www-authenticate', 'cache-control', 'etag'], true)) {
                $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
            }
            return strlen($line);
        });
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        if ($method === 'HEAD') curl_setopt($ch, CURLOPT_NOBODY, true);
        $response = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return [$response, $code, $responseHeaders];
    }

    $method = $_SERVER['REQUEST_METHOD'];
    if (isset($_GET['API'])) {
        $apiPath = $_GET['API'];
        // Item, machine and power-source ids are path segments too (e.g. minecraft:iron_ingot:0), so a
        // segment may hold anything but separators, controls and dot-only names; each is re-encoded below.
        $segment = '(?!\.{1,2}(?:/|$))[^/?#\x00-\x1f\x7f]+';
        if (!is_string($apiPath) || !preg_match('~^(?:api(?:/' . $segment . ')+|icon)$~D', $apiPath)) {
            apiError(404, 'NOT_FOUND');
        }
        $publicAuth = in_array($apiPath, ['api/auth/login', 'api/auth/register'], true);
        $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        $hasBearer = preg_match('/^Bearer +\S+$/iD', $authorization) === 1;
        if (isset($_SERVER['HTTP_AUTHORIZATION']) && !$hasBearer) {
            apiError(401, 'UNAUTHORIZED');
        }
        $hasCookie = isset($_COOKIE['authenticationToken']);
        $mutation = !in_array($method, ['GET', 'HEAD', 'OPTIONS'], true);
        // Check the browser's marker before translating its cookie into an upstream Bearer token.
        if (!$hasBearer && $hasCookie && !$publicAuth && $mutation
                && ($_SERVER['HTTP_X_AE2_REQUEST'] ?? '') !== 'true') {
            apiError(403, 'CSRF_REJECTED');
        }
        if (!$hasBearer && !$hasCookie && !$publicAuth && $method !== 'OPTIONS') {
            apiError(401, 'UNAUTHORIZED');
        }
        $headers = ['Content-Type: ' . ($_SERVER['CONTENT_TYPE'] ?? '')];
        if ($hasBearer) $headers[] = 'Authorization: ' . $authorization;
        elseif ($hasCookie && !$publicAuth) $headers[] = 'Authorization: Bearer ' . $_COOKIE['authenticationToken'];
        $params = $_GET;
        unset($params['API']);
        $url = $AE2_SERVER_HOST . implode('/', array_map('rawurlencode', explode('/', $apiPath)));
        if ($params) $url .= '?' . http_build_query($params);
        [$response, $code, $responseHeaders] = upstreamRequest($url, $method, $headers,
            $mutation ? file_get_contents('php://input') : null);
        if ($response === false) apiError(502, 'UPSTREAM_UNAVAILABLE');
        header('Cache-Control: no-store');
        // Upstream's own caching headers win - item icons are meant to be cached.
        foreach ($responseHeaders as $name => $value) header($name . ': ' . $value);
        http_response_code($code ?: 502);
        echo $response;
        exit;
    }

    if ($method === 'POST' && !isSameOriginForm()) apiError(403, 'CSRF_REJECTED');
    if ($method === 'POST' && ($_POST['clearSession'] ?? '') === 'true') {
        // Expire cookies from the page directory where login set their default browser scope.
        clearSessionCookies();
        header('Location: .');
        exit;
    }
    if (!isset($_COOKIE['authenticationToken'])) {
        if ($method === 'POST' && isset($_POST['password'])) {
            $register = isset($_POST['register']);
            $remember = isset($_POST['remember']) && $_POST['remember'] === 'on';
            $body = ['username' => $register ? $_POST['register'] : ($_POST['username'] ?? ''),
                'password' => $_POST['password']];
            if (!$register) $body['rememberMe'] = $remember;
            [$response, $code] = upstreamRequest($AE2_SERVER_HOST . 'api/auth/' . ($register ? 'register' : 'login'),
                'POST', ['Content-Type: application/json'], json_encode($body));
            $envelope = $response === false ? null : json_decode($response, true);
            if ($envelope && $envelope['status'] === 'OK' && $code === ($register ? 202 : 200)) {
                $data = $envelope['data'];
                if ($register) {
                    header('Location: ?confirmregistration&token=' . rawurlencode($data['token']));
                } else {
                    $validity = time() + ($remember ? 604800 : 3600);
                    setcookie('authenticationToken', $data['token'], cookieOptions($validity, true));
                    setcookie('username', $data['username'], cookieOptions($validity, false));
                    setcookie('isAdmin', $data['isAdmin'] ? '1' : '0', cookieOptions($validity, false));
                    setcookie('isOutdated', $data['isOutdated'] ? '1' : '0', cookieOptions($validity, false));
                    header('Location: .');
                }
            } else {
                $status = $envelope['status'] ?? 'UPSTREAM_UNAVAILABLE';
                $knownError = in_array($status, ['NOT_ONLINE', 'INVALID_PASSWORD', 'INVALID_USER'], true);
                header('Location: ?' . ($knownError ? $status : 'error=' . rawurlencode($status)));
            }
            exit;
        }
        $loginfile = file_get_contents(__DIR__ . '/login.html');
        echo str_replace('_REPLACE_ME_IS_PUBLIC_MODE', $AE2_IS_PUBLIC_MODE ? 'true' : 'false', $loginfile);
        exit;
    }

    // Serves the same self-contained webpage.html the mod itself serves (http.WebHandler) - `web/`'s build
    // copies it here alongside login.html (see web/vite.config.ts), substituting the same six placeholders by
    // plain string replacement. username/isAdmin/isOutdated were stored in cookies at login, so - unlike the
    // mod, which reads them off the live session - this only reads them back.
    $webpage = file_get_contents(__DIR__ . '/webpage.html');
    $webpage = str_replace('_REPLACE_ME_USERNAME', htmlspecialchars($_COOKIE['username'] ?? '', ENT_QUOTES), $webpage);
    $webpage = str_replace('_REPLACE_ME_IS_ADMIN', ($_COOKIE['isAdmin'] ?? '') === '1' ? 'true' : 'false', $webpage);
    $webpage = str_replace('_REPLACE_ME_VERSION_OUTDATED', ($_COOKIE['isOutdated'] ?? '') === '1' ? 'true' : 'false', $webpage);
    $webpage = str_replace('_REPLACE_ME_IS_PUBLIC_MODE', $AE2_IS_PUBLIC_MODE ? 'true' : 'false', $webpage);
    $webpage = str_replace('_REPLACE_ME_HAS_ITEM_ICONS', $AE2_HAS_ITEM_ICONS ? 'true' : 'false', $webpage);
    $webpage = str_replace('_REPLACE_ME_HAS_GT', $AE2_HAS_GT ? 'true' : 'false', $webpage);
    header('Content-Type: text/html; charset=UTF-8');
    echo $webpage;

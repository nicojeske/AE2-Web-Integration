<?php

    // Lax matches what browsers already apply to a cookie with no SameSite, so this mainly covers older
    // ones. It stops an image tag or a cross-site fetch carrying the session, but not a top-level
    // navigation - and the endpoints behind this proxy are state-changing GETs, so the real fix is to
    // move them to POST. PHP's positional setcookie() has no SameSite parameter; the options array does.
    function cookieOptions($expires, $httpOnly) {
        return [
            'expires' => $expires,
            'path' => '/',
            'httponly' => $httpOnly,
            'samesite' => 'Lax',
        ];
    }

    // AE2 Web Terminal url
    $AE2_SERVER_HOST = "http://localhost:2324/";
    // Is the public mode enabled on the server
    $AE2_IS_PUBLIC_MODE = true;
    // Mirror the mod's own item_icon_directory config: true only if that server was actually built
    // with a non-empty one (AE2Controller has no endpoint to ask it directly, so this has to be kept
    // in sync by hand). Left false, the terminal falls back to its generated placeholder tiles - the
    // same degradation `ItemIcon.tsx` already has for a network with icons genuinely disabled.
    $AE2_HAS_ITEM_ICONS = false;

    if (!isset($_COOKIE['authenticationToken'])) {

        if (isset($_POST['register'])){
            $username = $_POST['register'];
            $password = $_POST['password'];
            $ch = curl_init($AE2_SERVER_HOST . 'auth');
            curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type: application/xml'));
            curl_setopt($ch, CURLOPT_HEADER, FALSE);
            curl_setopt($ch, CURLOPT_TIMEOUT, 30);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, TRUE);
            curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($_POST));
            $return = curl_exec($ch);
            $httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpcode == 400){
                header("Location: ?" . $return);
                exit;
            }
            elseif ($httpcode == 200){
                header("Location: ?confirmregistration&token=" . $return);
                exit;
            }
        }

        if (isset($_POST['password'])){
            $password = $_POST['password'];
            $remember = isset($_POST['remember']) && $_POST['remember'] == 'on';
            $ch = curl_init($AE2_SERVER_HOST . 'auth');
            curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type: application/xml'));
            curl_setopt($ch, CURLOPT_HEADER, FALSE);
            curl_setopt($ch, CURLOPT_TIMEOUT, 30);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, TRUE);
            curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($_POST));
            $return = curl_exec($ch);
            $httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpcode == 400){
                header("Location: ?" . $return);
                exit;
            }
            elseif ($httpcode == 200){
                $json = json_decode($return, true);
                $validity = $remember ? (time() + (604_800)) : (time() + (3600));
                setcookie("authenticationToken", $json['token'], cookieOptions($validity, true));
                setcookie("username", $json['username'], cookieOptions($validity, false));
                setcookie("isAdmin", $json['isAdmin'] ? '1' : '0', cookieOptions($validity, false));
                setcookie("isOutdated", $json['isOutdated'] ? '1' : '0', cookieOptions($validity, false));
                header("Location: .");
                exit;
            }
        }


        $loginfile = file_get_contents("login.html");
        $loginfile = str_replace("_REPLACE_ME_IS_PUBLIC_MODE", $AE2_IS_PUBLIC_MODE ? "true" : "false", $loginfile);
        echo $loginfile;
        exit;
    }
    if (isset($_GET['logout'])) {
        $ch = curl_init($AE2_SERVER_HOST . 'auth?revoke');
        curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type: application/xml', 'Authorization: Bearer ' . $_COOKIE['authenticationToken']));
        curl_setopt($ch, CURLOPT_HEADER, FALSE);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, TRUE);
        $return = curl_exec($ch);
        $httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $validity = (time() - 3600);
        setcookie("authenticationToken", "", cookieOptions($validity, true));
        setcookie("username", "", cookieOptions($validity, false));
        setcookie("isAdmin", '', cookieOptions($validity, false));
        setcookie("isOutdated", '', cookieOptions($validity, false));
        header("Location: .");
        exit;
    }

    if (isset($_GET['API'])){

        $api_path = $_GET['API'];
        unset($_GET['API']);


        $params = $_GET;

        $ch = curl_init($AE2_SERVER_HOST . $api_path . '?' . http_build_query($params));
        curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type: application/xml', 'Authorization: Bearer ' . $_COOKIE['authenticationToken']));
        curl_setopt($ch, CURLOPT_HEADER, FALSE);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, TRUE);
        $return = curl_exec($ch);
        $httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpcode == 401) {
            $validity = (time() - 3600);
            setcookie("authenticationToken", "", cookieOptions(time() - 3600, true));
            setcookie("username", "", cookieOptions($validity, false));
            setcookie("isAdmin", '', cookieOptions($validity, false));
            setcookie("isOutdated", '', cookieOptions($validity, false));
            header("Location: .");
            exit;
        }

        print($return);

        exit;
    }

    // Serves the same self-contained webpage.html the mod itself serves (AE2Controller.WebHandler) -
    // `web/`'s build copies it here alongside login.html (see web/vite.config.ts), substituting the
    // same five placeholders by plain string replacement. username/isAdmin/isOutdated already live in
    // cookies set at login above, so - unlike the mod, which reads them off the live WebPrincipal -
    // this only ever needs to read them back.
    $webpage = file_get_contents("webpage.html");
    $webpage = str_replace("_REPLACE_ME_USERNAME", $_COOKIE['username'], $webpage);
    $webpage = str_replace("_REPLACE_ME_IS_ADMIN", $_COOKIE['isAdmin'] == '1' ? "true" : "false", $webpage);
    $webpage = str_replace("_REPLACE_ME_VERSION_OUTDATED", $_COOKIE['isOutdated'] == '1' ? "true" : "false", $webpage);
    $webpage = str_replace("_REPLACE_ME_IS_PUBLIC_MODE", $AE2_IS_PUBLIC_MODE ? "true" : "false", $webpage);
    $webpage = str_replace("_REPLACE_ME_HAS_ITEM_ICONS", $AE2_HAS_ITEM_ICONS ? "true" : "false", $webpage);
    echo $webpage;
?>

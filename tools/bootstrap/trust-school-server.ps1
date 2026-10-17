#Requires -Version 5.1
<#
School client kit: the administrator supplies one public certificate and one
fingerprint manifest through a trusted channel (USB or managed distribution).
No network is used to decide trust. No administrator SSH password is needed.
Only CurrentUser\Root is modified, after an explicit confirmation dialog.
Use -CheckOnly for read-only verification; no bypass of TLS checks is supported.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$BundlePath,
    [switch]$CheckOnly,
    [switch]$ApproveTrust,
    [switch]$NoOpen
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$bundle=(Resolve-Path -LiteralPath $BundlePath).Path
$manifestPath=Join-Path $bundle 'school-server.json'
$certFile=Join-Path $bundle 'asa-school-root.cer'
$manifest=Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schema -ne 1) {throw 'Unknown school client-kit schema.'}
if ($manifest.ca_sha256 -notmatch '^[a-fA-F0-9]{64}$') {throw 'Invalid CA fingerprint.'}
$origin=[Uri]$manifest.origin
if ($origin.Scheme -ne 'https' -or $origin.Port -ne 4610 -or $origin.AbsolutePath -ne '/' -or $origin.UserInfo -or $origin.Query -or $origin.Fragment) {
    throw 'Only a local HTTPS school entry on port 4610 is allowed.'
}
$ip=[System.Net.IPAddress]::Parse($origin.Host)
$bytes=$ip.GetAddressBytes()
$private=($bytes.Length -eq 4) -and (($bytes[0] -eq 10) -or
    ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
    ($bytes[0] -eq 192 -and $bytes[1] -eq 168))
if (-not $private) {throw 'The entry address must be a private school IPv4 address.'}
$file=Get-Item -LiteralPath $certFile
if ($file.Length -lt 128 -or $file.Length -gt 32768 -or $file.LinkType) {throw 'Unexpected public certificate file.'}
$actual=(Get-FileHash -LiteralPath $certFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -cne $manifest.ca_sha256.ToLowerInvariant()) {throw 'Certificate fingerprint mismatch. Nothing trusted.'}
$cert=New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certFile)
if ($cert.HasPrivateKey) {throw 'A client kit must never contain a private key.'}
if ($cert.NotBefore -gt (Get-Date) -or $cert.NotAfter -lt (Get-Date)) {throw 'School CA is outside validity period.'}
$constraints=@($cert.Extensions | Where-Object {$_.Oid.Value -eq '2.5.29.19'})
if ($constraints.Count -ne 1 -or -not $constraints[0].CertificateAuthority) {throw 'Expected a CA public certificate.'}
$storePath='Cert:\CurrentUser\Root\'+$cert.Thumbprint
$trusted=Test-Path -LiteralPath $storePath
Write-Output ('CA_SHA256='+$actual)
Write-Output ('SCHOOL_ENTRY='+$manifest.origin)
Write-Output ('CURRENT_USER_TRUSTED='+$trusted)
if ($CheckOnly) {
    Write-Output 'CHECK_ONLY: certificate store, DNS, VPN and firewall unchanged.'
    exit 0
}
if (-not $trusted) {
    if (-not $ApproveTrust) {
        Add-Type -AssemblyName System.Windows.Forms
        $message='Trust the local HTTPS authority of your school for THIS Windows user?'+[Environment]::NewLine+
            'Use only a kit received from your school administrator.'+[Environment]::NewLine+
            'This root can issue certificates. Verify this SHA256 with the administrator:'+[Environment]::NewLine+
            $actual+[Environment]::NewLine+'Server: '+$manifest.origin+[Environment]::NewLine+
            'No DNS, VPN, firewall, or computer-wide trust settings are changed.'
        $answer=[System.Windows.Forms.MessageBox]::Show($message,'ASA Lab - school HTTPS',
            [System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Question,
            [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
        if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
            Write-Output 'CANCELLED: no trust change.'
            exit 2
        }
    }
    Import-Certificate -FilePath $certFile -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
}
if (-not (Test-Path -LiteralPath $storePath)) {throw 'Windows did not accept the school CA.'}
Write-Output ('TRUSTED_PUBLIC_CA='+$cert.Thumbprint)
Write-Output ('To revoke only this certificate: Remove-Item -LiteralPath '+$storePath)
try {
    $ready=Invoke-RestMethod -TimeoutSec 15 -Uri ($manifest.origin+'/health/ready')
    if ($ready.status -ne 'ready') {throw 'Application readiness is not ready.'}
    Write-Output 'SCHOOL_TLS_AND_API_READY'
} catch {
    Write-Warning 'The CA is installed, but this address is unavailable or TLS validation failed. Check the current school server address. Do not disable certificate checks.'
    throw
}
if (-not $NoOpen) {Start-Process ($manifest.origin+'/#/home')}

/**
 * Anonymised example configurations.
 *
 * Both are structurally based on real-world HAProxy patterns but use the
 * documentation TLDs (example.com / example.net) and TEST-NET IP ranges
 * (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24). No real hostnames, private
 * addresses, certificate names or personal data are included.
 */

const SNI_PASSTHROUGH = `# ---------------------------------------------------------------------------
# Example A — SNI passthrough at the edge, shared TLS termination on loopback
# All hostnames and addresses are documentation values.
# ---------------------------------------------------------------------------
global
    log /dev/log    local0
    log /dev/log    local1 notice
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin
    stats timeout 30s
    user haproxy
    group haproxy
    daemon

    ca-base /etc/ssl/certs
    crt-base /etc/ssl/private

    ssl-default-bind-ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384
    ssl-default-bind-ciphersuites TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256
    ssl-default-bind-options ssl-min-ver TLSv1.2 no-tls-tickets

defaults
    log     global
    mode    http
    option  httplog
    option  dontlognull

    timeout connect 5000
    timeout client  50000
    timeout server  50000

    errorfile 400 /etc/haproxy/errors/400.http
    errorfile 403 /etc/haproxy/errors/403.http
    errorfile 408 /etc/haproxy/errors/408.http
    errorfile 500 /etc/haproxy/errors/500.http
    errorfile 502 /etc/haproxy/errors/502.http
    errorfile 503 /etc/haproxy/errors/503.http
    errorfile 504 /etc/haproxy/errors/504.http

# ============================================================
# EDGE — TLS PASSTHROUGH BY SNI
# ============================================================

frontend ft_edge
    bind *:443
    mode tcp

    tcp-request inspect-delay 1s
    tcp-request content accept if { req_ssl_hello_type 1 }
    tcp-request content capture req.ssl_sni len 100
    log-format "src=%ci dst=%fi:%fp sni=%[capture.req.hdr(0)]"

    # SSH over TLS passthrough
    use_backend bk_ssh if { req_ssl_sni -i ssh.example.net }

    # Wildcard service domain
    use_backend bk_og if { req_ssl_sni -i og.example.net }
    use_backend bk_og if { req_ssl_sni -m end .og.example.net }

    # Third-party partner domain
    use_backend bk_partner if { req_ssl_sni -m end .partner.example }

    # Public example.com services are decrypted on the loopback frontend
    use_backend bk_example_tls if { req_ssl_sni -i sendpass.example.com }
    use_backend bk_example_tls if { req_ssl_sni -i sendfile.example.com }
    use_backend bk_example_tls if { req_ssl_sni -i decode.example.com }
    use_backend bk_example_tls if { req_ssl_sni -i learning.example.com }

    default_backend bk_default

# ============================================================
# SHARED HTTPS TERMINATION FOR EXAMPLE.COM
# ============================================================

frontend ft_example_tls
    # HTTP/1.1 is forced here to avoid HTTP/2 connection coalescing
    # between the example.com services and other hosts.
    bind 127.0.0.1:8443 ssl crt /etc/haproxy/certs/example.pem alpn http/1.1
    mode http
    option httplog

    http-request set-header X-Forwarded-Proto https
    http-request set-header X-Forwarded-Port 443

    # Wildcard services must never arrive on the example.com frontend.
    http-request return status 421 content-type "text/plain" string "Misdirected request" if { hdr(host) -m end .og.example.net }

    use_backend bk_learning if { hdr(host) -i learning.example.com }
    use_backend bk_sendpass if { hdr(host) -i sendpass.example.com }
    use_backend bk_sendfile if { hdr(host) -i sendfile.example.com }
    use_backend bk_decode if { hdr(host) -i decode.example.com }

    default_backend bk_example_default

# ============================================================
# TCP BACKENDS
# ============================================================

backend bk_ssh
    mode tcp
    option tcp-check
    server ssh 192.0.2.50:443

backend bk_og
    mode tcp
    option tcp-check
    server og 192.0.2.10:443

backend bk_partner
    mode tcp
    option tcp-check
    server partner 198.51.100.30:443

backend bk_default
    mode tcp
    tcp-request content reject

backend bk_example_tls
    mode tcp
    server example_tls 127.0.0.1:8443

# ============================================================
# HTTP BACKENDS
# ============================================================

backend bk_sendpass
    mode http
    option httpchk
    server sendpass 192.0.2.40:8000

backend bk_sendfile
    mode http
    option httpchk
    server sendfile 192.0.2.40:8001

backend bk_decode
    mode http
    option httpchk
    server decode 192.0.2.40:8002

backend bk_learning
    mode http
    option httpchk
    server learning 192.0.2.40:8003

backend bk_example_default
    mode http
    http-request return status 404 content-type "text/plain" string "Unknown example.com service"
`;

const EDGE_TLS = `# ---------------------------------------------------------------------------
# Example B — edge TLS termination, client metadata and sticky sessions
# All hostnames and addresses are documentation values.
# ---------------------------------------------------------------------------
global
    log /dev/log    local0
    #log /dev/log    local1 notice
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin expose-fd listeners
    stats timeout 30s
    user haproxy
    group haproxy
    daemon

    ca-base /etc/ssl/certs
    crt-base /etc/ssl/private

    ssl-default-bind-ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384
    ssl-default-bind-ciphersuites TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256
    ssl-default-bind-options prefer-client-ciphers no-sslv3 no-tlsv10 no-tlsv11 no-tls-tickets

    ssl-dh-param-file /etc/haproxy/dh_params.pem
    tune.ssl.default-dh-param 2048

    tune.bufsize 16384
    maxconn 50000

defaults
    log     global
    mode    http
    option  httplog
    option  dontlognull
    option  dontlog-normal
    option  forwardfor header X-Client-IP

    option  http-keep-alive
    http-reuse never

    timeout connect 30s
    timeout client  60s
    timeout server  60s
    timeout tunnel  24h
    maxconn 50000

    errorfile 400 /etc/haproxy/errors/400.http
    errorfile 403 /etc/haproxy/errors/403.http
    errorfile 408 /etc/haproxy/errors/408.http
    errorfile 500 /etc/haproxy/errors/500.http
    errorfile 502 /etc/haproxy/errors/502.http
    errorfile 503 /etc/haproxy/errors/503.http
    errorfile 504 /etc/haproxy/errors/504.http

frontend http-https
    bind 0.0.0.0:80
    bind 0.0.0.0:443 ssl crt /etc/haproxy/certs/example.pem

    acl site_dead nbsrv(nodes) lt 1
    monitor-uri /site_alive
    monitor fail if site_dead

    # Strip identity headers supplied by the client; HAProxy will set its own.
    http-request del-header CC_SDN
    http-request del-header CC_IDN
    http-request del-header CC_CRT
    http-request del-header X-SSL-Protocol
    http-request del-header X-SSL-Cipher

    http-request set-header X-SSL-Protocol %[ssl_fc_protocol] if { ssl_fc }
    http-request set-header X-SSL-Cipher %[ssl_fc_cipher] if { ssl_fc }

    capture cookie SID= len 34

    default_backend nodes

# This frontend has no bind line on purpose: the analyzer should flag it.
# A real deployment would either remove it or give it a bind and a clear role.
frontend clientcert
    http-request del-header CC_SDN
    http-request del-header CC_IDN
    http-request del-header CC_CRT
    http-request set-header CC_SDN  %{+Q}[ssl_c_s_dn]
    http-request set-header CC_IDN  %{+Q}[ssl_c_i_dn]
    http-request set-header CC_CRT  %{+Q}[ssl_c_der,base64]
    http-request set-header X-SSL-Cipher %[ssl_fc_cipher] if { ssl_fc }
    capture cookie SID= len 34
    default_backend nodes

backend nodes
    balance leastconn
    stick-table type string len 10 size 5M expire 30m
    stick store-response res.cook(SID) table nodes
    stick on req.cook(SID) table nodes

#<----------START_BACKEND---------->
server node-1 127.0.0.1:2801 weight 100 check maxconn 50000 id 1
`;

export const SAMPLES = [
  {
    id: 'sni-passthrough',
    name: 'SNI passthrough + loopback termination',
    short: 'Example A',
    description:
      'A TCP edge inspects SNI and forwards encrypted traffic. Selected example.com hostnames are handed to a loopback HTTP frontend that terminates TLS and routes by Host.',
    architecture: 'TCP/SNI edge → loopback TLS termination → HTTP backends',
    highlights: [
      'TLS passthrough for SSH, wildcard and partner services',
      'Shared loopback certificate termination',
      'Explicit 421/404 fallbacks',
      'Health-check options without server checks — a common mistake',
    ],
    text: SNI_PASSTHROUGH,
  },
  {
    id: 'edge-tls',
    name: 'Edge TLS + client metadata + stick tables',
    short: 'Example B',
    description:
      'One public frontend serves HTTP and HTTPS, strips untrusted identity headers, forwards TLS metadata and uses cookie-based stickiness to a single application node.',
    architecture: 'HTTP/HTTPS edge → sticky HTTP backend → application node',
    highlights: [
      'Conditional X-SSL-Protocol and X-SSL-Cipher headers',
      'Cookie stick table',
      'A deliberately unbounded clientcert frontend for analysis',
      '`http-reuse never` and no HTTP→HTTPS redirect — review items',
    ],
    text: EDGE_TLS,
  },
];

export function getSample(id) {
  return SAMPLES.find((sample) => sample.id === id) || null;
}

export const SAMPLE_EDGE_TLS = EDGE_TLS;
export const SAMPLE_SNI_PASSTHROUGH = SNI_PASSTHROUGH;
